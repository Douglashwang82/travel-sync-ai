/**
 * Model-agnostic LLM client. Routes between Gemini (cheap/fast) and
 * Anthropic Claude (reasoning) by task class, with optional per-call
 * overrides. Every call writes a row to `llm_calls` for cost + replay.
 *
 * Why two providers:
 *   - Gemini Flash dominates on $/token for parsing + small classification.
 *   - Claude 4.x is materially better at the orchestrator's tool-use loop
 *     (multi-turn planning + tool selection). That's where we spend most of
 *     our compute, and where quality matters most.
 *
 * Selection:
 *   - Read LLM_PROVIDER_<TASK_CLASS> (e.g. LLM_PROVIDER_ORCHESTRATOR=anthropic)
 *   - Fall back to LLM_PROVIDER_DEFAULT
 *   - Fall back to 'gemini' (which is what's wired up today)
 *
 * The Gemini path delegates to lib/gemini.ts so the circuit breaker,
 * grounded search, and embeddings keep working. The Anthropic path is
 * implemented inline.
 *
 * NOTE: This file does NOT yet replace existing call sites — services keep
 * importing lib/gemini.ts directly. lib/llm.ts is the new path; migrate
 * callers incrementally as you touch them.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { ZodType } from "zod";
import {
  generateConversation as geminiConversation,
  generateJson as geminiJson,
  generateText as geminiText,
  GeminiUnavailableError,
  GeminiSchemaError,
  getModel as getGeminiModel,
  type ConversationMessage,
} from "@/lib/gemini";
import {
  recordLlmCall,
  type LlmProvider,
  type LlmTaskClass,
} from "@/lib/llm-telemetry";
import { tryLoadPrompt, type PromptFile } from "@/lib/prompts";

export class LlmUnavailableError extends Error {
  constructor(message = "LLM provider is temporarily unavailable") {
    super(message);
    this.name = "LlmUnavailableError";
  }
}

export class LlmSchemaError extends Error {
  constructor(message: string, public readonly raw: string) {
    super(message);
    this.name = "LlmSchemaError";
  }
}

export interface LlmCallOptions {
  taskClass: LlmTaskClass;
  /** Override the env-driven provider routing for this call. */
  provider?: LlmProvider;
  /** Override the provider's default model for this call. */
  model?: string;
  /** Prompt registry id; resolved system prompt body is sent to the provider. */
  promptId?: string;
  /** Inline system prompt (used when promptId is omitted). */
  systemPrompt?: string;
  /** Variables for renderPrompt when promptId is used. */
  promptVars?: Record<string, string>;
  tripId?: string;
  orchestratorRunId?: string;
  metadata?: Record<string, unknown>;
}

interface ResolvedPrompt {
  body: string;
  id?: string;
  hash?: string;
}

function resolveSystemPrompt(opts: LlmCallOptions): ResolvedPrompt {
  if (opts.promptId) {
    const p = tryLoadPrompt(opts.promptId);
    if (!p) throw new Error(`LLM call references unknown prompt id: ${opts.promptId}`);
    const body = opts.promptVars ? renderInline(p, opts.promptVars) : p.body;
    return { body, id: p.id, hash: p.hash };
  }
  if (opts.systemPrompt) return { body: opts.systemPrompt };
  return { body: "" };
}

function renderInline(prompt: PromptFile, vars: Record<string, string>): string {
  return prompt.body.replace(/\{\{\s*([a-z_][a-z0-9_]*)\s*\}\}/gi, (_, key: string) => {
    if (!(key in vars)) throw new Error(`Missing placeholder "${key}" for prompt ${prompt.id}`);
    return vars[key]!;
  });
}

function pickProvider(taskClass: LlmTaskClass, override?: LlmProvider): LlmProvider {
  if (override) return override;
  const taskEnv = process.env[`LLM_PROVIDER_${taskClass.toUpperCase()}`];
  if (taskEnv === "anthropic" || taskEnv === "gemini") return taskEnv;
  const def = process.env.LLM_PROVIDER_DEFAULT;
  if (def === "anthropic" || def === "gemini") return def;
  return "gemini";
}

const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-6";

function getAnthropicModel(override?: string): string {
  if (override) return override;
  const env = process.env.ANTHROPIC_MODEL?.trim();
  return env || DEFAULT_ANTHROPIC_MODEL;
}

let _anthropic: Anthropic | null = null;
function getAnthropic(): Anthropic {
  if (!_anthropic) {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new LlmUnavailableError("ANTHROPIC_API_KEY is not set");
    _anthropic = new Anthropic({ apiKey: key });
  }
  return _anthropic;
}

// ─── completeText ────────────────────────────────────────────────────────────

export async function completeText(
  userMessage: string,
  opts: LlmCallOptions,
): Promise<string> {
  const provider = pickProvider(opts.taskClass, opts.provider);
  const system = resolveSystemPrompt(opts);
  const started = Date.now();

  if (provider === "anthropic") {
    const model = getAnthropicModel(opts.model);
    try {
      const client = getAnthropic();
      const resp = await client.messages.create({
        model,
        max_tokens: 2048,
        system: system.body,
        messages: [{ role: "user", content: userMessage }],
      });
      const text = resp.content
        .map((b) => (b.type === "text" ? b.text : ""))
        .join("")
        .trim();
      await recordLlmCall({
        provider: "anthropic",
        model,
        taskClass: opts.taskClass,
        promptId: system.id,
        promptHash: system.hash,
        tokensIn: resp.usage?.input_tokens ?? undefined,
        tokensOut: resp.usage?.output_tokens ?? undefined,
        latencyMs: Date.now() - started,
        status: "ok",
        tripId: opts.tripId,
        orchestratorRunId: opts.orchestratorRunId,
        metadata: opts.metadata,
      });
      return text;
    } catch (err) {
      await recordLlmCall({
        provider: "anthropic",
        model,
        taskClass: opts.taskClass,
        promptId: system.id,
        promptHash: system.hash,
        latencyMs: Date.now() - started,
        status: "error",
        error: err instanceof Error ? err.message : String(err),
        tripId: opts.tripId,
        orchestratorRunId: opts.orchestratorRunId,
        metadata: opts.metadata,
      });
      throw err;
    }
  }

  // Gemini path
  const model = opts.model ?? getGeminiModel();
  try {
    const text = await geminiText(system.body, userMessage);
    await recordLlmCall({
      provider: "gemini",
      model,
      taskClass: opts.taskClass,
      promptId: system.id,
      promptHash: system.hash,
      latencyMs: Date.now() - started,
      status: "ok",
      tripId: opts.tripId,
      orchestratorRunId: opts.orchestratorRunId,
      metadata: opts.metadata,
    });
    return text;
  } catch (err) {
    const isUnavailable = err instanceof GeminiUnavailableError;
    await recordLlmCall({
      provider: "gemini",
      model,
      taskClass: opts.taskClass,
      promptId: system.id,
      promptHash: system.hash,
      latencyMs: Date.now() - started,
      status: isUnavailable ? "circuit_open" : "error",
      error: err instanceof Error ? err.message : String(err),
      tripId: opts.tripId,
      orchestratorRunId: opts.orchestratorRunId,
      metadata: opts.metadata,
    });
    if (isUnavailable) throw new LlmUnavailableError(err.message);
    throw err;
  }
}

// ─── completeJson ────────────────────────────────────────────────────────────

export async function completeJson<T>(
  userMessage: string,
  opts: LlmCallOptions & { schema: ZodType<T> },
): Promise<T> {
  const provider = pickProvider(opts.taskClass, opts.provider);
  const system = resolveSystemPrompt(opts);
  const started = Date.now();

  if (provider === "anthropic") {
    const model = getAnthropicModel(opts.model);
    try {
      const client = getAnthropic();
      const jsonInstruction = `${system.body}\n\nRespond with valid JSON only. No prose, no code fences.`;
      const resp = await client.messages.create({
        model,
        max_tokens: 4096,
        system: jsonInstruction,
        messages: [{ role: "user", content: userMessage }],
      });
      const raw = resp.content
        .map((b) => (b.type === "text" ? b.text : ""))
        .join("")
        .trim();
      const cleaned = stripCodeFence(raw);
      const parsedJson = JSON.parse(cleaned);
      const parsed = opts.schema.safeParse(parsedJson);
      if (!parsed.success) {
        throw new LlmSchemaError(
          `Anthropic JSON failed schema validation: ${parsed.error.message}`,
          cleaned,
        );
      }
      await recordLlmCall({
        provider: "anthropic",
        model,
        taskClass: opts.taskClass,
        promptId: system.id,
        promptHash: system.hash,
        tokensIn: resp.usage?.input_tokens ?? undefined,
        tokensOut: resp.usage?.output_tokens ?? undefined,
        latencyMs: Date.now() - started,
        status: "ok",
        tripId: opts.tripId,
        orchestratorRunId: opts.orchestratorRunId,
        metadata: opts.metadata,
      });
      return parsed.data;
    } catch (err) {
      await recordLlmCall({
        provider: "anthropic",
        model,
        taskClass: opts.taskClass,
        promptId: system.id,
        promptHash: system.hash,
        latencyMs: Date.now() - started,
        status: "error",
        error: err instanceof Error ? err.message : String(err),
        tripId: opts.tripId,
        orchestratorRunId: opts.orchestratorRunId,
        metadata: opts.metadata,
      });
      throw err;
    }
  }

  // Gemini path
  const model = opts.model ?? getGeminiModel();
  try {
    const data = await geminiJson<T>(system.body, userMessage, opts.schema);
    await recordLlmCall({
      provider: "gemini",
      model,
      taskClass: opts.taskClass,
      promptId: system.id,
      promptHash: system.hash,
      latencyMs: Date.now() - started,
      status: "ok",
      tripId: opts.tripId,
      orchestratorRunId: opts.orchestratorRunId,
      metadata: opts.metadata,
    });
    return data;
  } catch (err) {
    const isUnavailable = err instanceof GeminiUnavailableError;
    const isSchema = err instanceof GeminiSchemaError;
    await recordLlmCall({
      provider: "gemini",
      model,
      taskClass: opts.taskClass,
      promptId: system.id,
      promptHash: system.hash,
      latencyMs: Date.now() - started,
      status: isUnavailable ? "circuit_open" : "error",
      error: err instanceof Error ? err.message : String(err),
      tripId: opts.tripId,
      orchestratorRunId: opts.orchestratorRunId,
      metadata: opts.metadata,
    });
    if (isUnavailable) throw new LlmUnavailableError(err.message);
    if (isSchema) throw new LlmSchemaError(err.message, err.raw);
    throw err;
  }
}

// ─── completeConversation ────────────────────────────────────────────────────

export async function completeConversation(
  history: ConversationMessage[],
  newMessage: string,
  opts: LlmCallOptions,
): Promise<string> {
  const provider = pickProvider(opts.taskClass, opts.provider);
  const system = resolveSystemPrompt(opts);
  const started = Date.now();

  if (provider === "anthropic") {
    const model = getAnthropicModel(opts.model);
    try {
      const client = getAnthropic();
      const messages = [
        ...history.map((m) => ({
          role: m.role === "agent" ? ("assistant" as const) : ("user" as const),
          content: m.content,
        })),
        { role: "user" as const, content: newMessage },
      ];
      const resp = await client.messages.create({
        model,
        max_tokens: 2048,
        system: system.body,
        messages,
      });
      const text = resp.content
        .map((b) => (b.type === "text" ? b.text : ""))
        .join("");
      await recordLlmCall({
        provider: "anthropic",
        model,
        taskClass: opts.taskClass,
        promptId: system.id,
        promptHash: system.hash,
        tokensIn: resp.usage?.input_tokens ?? undefined,
        tokensOut: resp.usage?.output_tokens ?? undefined,
        latencyMs: Date.now() - started,
        status: "ok",
        tripId: opts.tripId,
        orchestratorRunId: opts.orchestratorRunId,
        metadata: opts.metadata,
      });
      return text;
    } catch (err) {
      await recordLlmCall({
        provider: "anthropic",
        model,
        taskClass: opts.taskClass,
        promptId: system.id,
        promptHash: system.hash,
        latencyMs: Date.now() - started,
        status: "error",
        error: err instanceof Error ? err.message : String(err),
        tripId: opts.tripId,
        orchestratorRunId: opts.orchestratorRunId,
        metadata: opts.metadata,
      });
      throw err;
    }
  }

  const model = opts.model ?? getGeminiModel();
  try {
    const text = await geminiConversation(system.body, history, newMessage);
    await recordLlmCall({
      provider: "gemini",
      model,
      taskClass: opts.taskClass,
      promptId: system.id,
      promptHash: system.hash,
      latencyMs: Date.now() - started,
      status: "ok",
      tripId: opts.tripId,
      orchestratorRunId: opts.orchestratorRunId,
      metadata: opts.metadata,
    });
    return text;
  } catch (err) {
    const isUnavailable = err instanceof GeminiUnavailableError;
    await recordLlmCall({
      provider: "gemini",
      model,
      taskClass: opts.taskClass,
      promptId: system.id,
      promptHash: system.hash,
      latencyMs: Date.now() - started,
      status: isUnavailable ? "circuit_open" : "error",
      error: err instanceof Error ? err.message : String(err),
      tripId: opts.tripId,
      orchestratorRunId: opts.orchestratorRunId,
      metadata: opts.metadata,
    });
    if (isUnavailable) throw new LlmUnavailableError(err.message);
    throw err;
  }
}

function stripCodeFence(s: string): string {
  const m = s.match(/^\s*```(?:json)?\s*\n?([\s\S]*?)\n?\s*```\s*$/i);
  return m ? m[1]!.trim() : s.trim();
}

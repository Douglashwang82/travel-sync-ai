/**
 * Records every LLM call into llm_calls. Best-effort: a write failure here
 * must NOT bubble up to the caller — degraded telemetry is preferable to a
 * broken request path.
 *
 * Call from lib/llm.ts and lib/gemini.ts wrappers. The orchestrator runner
 * passes `orchestratorRunId` so each turn's calls are linkable to the run.
 */

import { createAdminClient } from "@/lib/db";
import { captureError } from "@/lib/monitoring";
import { estimateCostUsd } from "@/lib/llm-pricing";

export type LlmProvider = "gemini" | "anthropic";

export type LlmTaskClass =
  | "orchestrator"
  | "parsing"
  | "private_chat"
  | "agent_summary"
  | "trip_generation"
  | "extractor"
  | "other";

export interface LlmCallRecord {
  provider: LlmProvider;
  model: string;
  taskClass?: LlmTaskClass;
  promptId?: string;
  promptHash?: string;
  tokensIn?: number;
  tokensOut?: number;
  cachedTokensIn?: number;
  costUsd?: number | null;
  latencyMs: number;
  status: "ok" | "error" | "circuit_open";
  error?: string;
  tripId?: string;
  orchestratorRunId?: string;
  metadata?: Record<string, unknown>;
}

export async function recordLlmCall(record: LlmCallRecord): Promise<void> {
  try {
    const db = createAdminClient();
    const cost =
      record.costUsd ??
      (record.tokensIn !== undefined && record.tokensOut !== undefined
        ? estimateCostUsd(record.model, record.tokensIn, record.tokensOut, record.cachedTokensIn ?? 0)
        : null);

    await db.from("llm_calls").insert({
      provider: record.provider,
      model: record.model,
      task_class: record.taskClass ?? null,
      prompt_id: record.promptId ?? null,
      prompt_hash: record.promptHash ?? null,
      tokens_in: record.tokensIn ?? null,
      tokens_out: record.tokensOut ?? null,
      cost_usd: cost ?? null,
      latency_ms: record.latencyMs,
      status: record.status,
      error: record.error ?? null,
      trip_id: record.tripId ?? null,
      orchestrator_run_id: record.orchestratorRunId ?? null,
      metadata: record.metadata ?? null,
    });
  } catch (err) {
    captureError(err, { context: "llm_telemetry_insert_failed", model: record.model });
  }
}

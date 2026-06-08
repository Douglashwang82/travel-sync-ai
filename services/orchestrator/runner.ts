import { z } from "zod";
import { after } from "next/server";
import { GoogleGenAI, FunctionCallingConfigMode, type FunctionCall, type Content } from "@google/genai";
import { createAdminClient } from "@/lib/db";
import { captureError } from "@/lib/monitoring";
import { GeminiUnavailableError, getModel } from "@/lib/gemini";
import { loadPrompt } from "@/lib/prompts";
import { recordLlmCall } from "@/lib/llm-telemetry";
import type { AgentAutonomy } from "@/services/agents/types";
import { listTools, getTool, listCustomGridAgents, listToolNames } from "./tools";
import type {
  OrchestratorActionStatus,
  OrchestratorRunSummary,
  OrchestratorTrigger,
  ToolAutonomyMap,
  ToolCallRecord,
  ToolContext,
  ToolDefinition,
} from "./types";

const MAX_TURNS = 8;
const ORCH_ACTOR = "orchestrator";

interface OrchestratorRow {
  id: string;
  trip_id: string;
  enabled: boolean;
  system_goal: string | null;
  tool_autonomy: ToolAutonomyMap | null;
  schedule_minutes: number;
  memory: Record<string, unknown> | null;
  consecutive_failures: number;
}

/**
 * Execute one orchestrator pass:
 *  1. Build trip context for the system prompt.
 *  2. Drive a Gemini tool-use loop, capped at MAX_TURNS.
 *  3. For each tool the model picks, enforce per-tool autonomy:
 *       - propose_only          → log a pending action; do not call execute().
 *       - auto_apply_with_undo  → execute(); log as 'applied' (UI shows undo).
 *       - auto_apply            → execute(); log as 'auto_applied'.
 *     Failed executions log as 'failed' and a function-response is returned
 *     to the model so it can react.
 *  4. Persist a run summary and schedule the next heartbeat.
 */
export async function runOrchestrator(
  orchestrator: OrchestratorRow,
  trigger: OrchestratorTrigger,
  triggerReason?: string,
): Promise<OrchestratorRunSummary> {
  const db = createAdminClient();
  const startedAt = new Date();

  const { data: runRow, error: runErr } = await db
    .from("orchestrator_runs")
    .insert({
      orchestrator_id: orchestrator.id,
      trigger,
      trigger_reason: triggerReason ?? null,
      status: "running",
      started_at: startedAt.toISOString(),
    })
    .select("id")
    .single();

  if (runErr || !runRow) {
    captureError(runErr ?? new Error("Failed to create orchestrator run row"), {
      context: "orchestrator_runner",
      orchestrator_id: orchestrator.id,
    });
    return {
      runId: "",
      status: "failed",
      proposed: 0,
      applied: 0,
      failed: 0,
      summary: "Run row insert failed",
      error: runErr?.message,
    };
  }
  const runId = runRow.id as string;

  try {
    const ctx: ToolContext = {
      tripId: orchestrator.trip_id,
      orchestratorId: orchestrator.id,
      actorKey: ORCH_ACTOR,
    };

    const autonomy = orchestrator.tool_autonomy ?? {};
    const context = await buildTripContext(orchestrator.trip_id);
    const { staticInstruction, dynamicContext, promptId, promptHash } = buildSystemPrompt(
      orchestrator,
      context,
      autonomy,
      trigger,
      triggerReason,
    );

    const { calls, finalText } = await driveToolLoop({
      staticInstruction,
      dynamicContext,
      promptId,
      promptHash,
      tripId: orchestrator.trip_id,
      ctx,
      autonomy,
      runId,
    });

    const counts = countByStatus(calls);
    const finishedAt = new Date();
    const summary = buildSummaryLine(calls, finalText);

    // Auto-chain budget. When the LLM materially restructures the plan via
    // `plan.upsert`, we want the orchestrator to immediately follow up and
    // start working the freshly generated tasks instead of leaving them all
    // undone until the next heartbeat. We bank a small number of chained
    // runs in memory; each subsequent run consumes one until the budget is
    // exhausted or no undone tasks remain.
    const usedPlanUpsert = calls.some(
      (c) => c.tool === "plan.upsert" && (c.status === "applied" || c.status === "auto_applied"),
    );
    const undoneTasksAfter = await countUndoneTasks(orchestrator.id);
    const prevMemory = (orchestrator.memory ?? {}) as Record<string, unknown>;
    const prevBudget = typeof prevMemory.autoChainsRemaining === "number" ? (prevMemory.autoChainsRemaining as number) : 0;
    // Fresh plan → refill to 4 (so plan-gen + 4 follow-ups = 5 runs total).
    // Otherwise drain whatever was banked.
    const nextBudget = usedPlanUpsert && undoneTasksAfter > 0 ? 4 : Math.max(0, prevBudget - 1);
    const shouldChain = nextBudget > 0 && undoneTasksAfter > 0;
    const memoryPatch: Record<string, unknown> = { ...prevMemory, autoChainsRemaining: nextBudget };

    await db
      .from("orchestrator_runs")
      .update({
        status: "success",
        summary,
        transcript: { calls, finalText } as unknown as Record<string, unknown>,
        finished_at: finishedAt.toISOString(),
        duration_ms: finishedAt.getTime() - startedAt.getTime(),
        tool_call_count: calls.length,
        applied_count: counts.applied + counts.auto_applied,
        proposed_count: counts.pending,
      })
      .eq("id", runId);

    // When we're about to chain, set `next_run_at` to "now" so the cron
    // sweeper also picks it up if `after()` somehow fails to execute. The
    // memory patch carries the budget into the next run.
    await db
      .from("trip_orchestrators")
      .update({
        last_run_at: finishedAt.toISOString(),
        next_run_at: shouldChain
          ? new Date().toISOString()
          : addMinutes(finishedAt, orchestrator.schedule_minutes).toISOString(),
        last_status: "success",
        last_summary: summary,
        last_error: null,
        consecutive_failures: 0,
        memory: memoryPatch,
        pending_reason: shouldChain ? `auto-chain after ${usedPlanUpsert ? "plan generation" : "task batch"} (${undoneTasksAfter} tasks left)` : null,
        pending_trigger: shouldChain ? "event" : null,
      })
      .eq("id", orchestrator.id);

    if (shouldChain) {
      scheduleAutoChain(orchestrator.id);
    }

    return {
      runId,
      status: "success",
      proposed: counts.pending,
      applied: counts.applied + counts.auto_applied,
      failed: counts.failed,
      summary,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const finishedAt = new Date();
    captureError(err, { context: "orchestrator_runner", orchestrator_id: orchestrator.id });

    await db
      .from("orchestrator_runs")
      .update({
        status: "failed",
        error: errMsg,
        finished_at: finishedAt.toISOString(),
        duration_ms: finishedAt.getTime() - startedAt.getTime(),
      })
      .eq("id", runId);

    const nextFailures = orchestrator.consecutive_failures + 1;
    const backoffMinutes = Math.min(
      orchestrator.schedule_minutes * Math.pow(2, nextFailures - 1),
      60 * 24,
    );
    await db
      .from("trip_orchestrators")
      .update({
        last_run_at: finishedAt.toISOString(),
        next_run_at: addMinutes(finishedAt, backoffMinutes).toISOString(),
        last_status: "failed",
        last_error: errMsg,
        consecutive_failures: nextFailures,
        pending_reason: null,
        pending_trigger: null,
      })
      .eq("id", orchestrator.id);

    return {
      runId,
      status: "failed",
      proposed: 0,
      applied: 0,
      failed: 0,
      summary: `Failed: ${errMsg}`,
      error: errMsg,
    };
  }
}

/**
 * Resolve a single member-dispatched task (a chat bubble dropped on the rail's
 * "Dispatched tasks" zone). A focused, one-shot variant of `runOrchestrator`:
 * it reuses the same static instruction, trip context, tools, and per-tool
 * autonomy, but the dynamic prompt directs the model to act on this one task
 * now. Mutating tools still obey autonomy (propose_only → a pending proposal),
 * so "resolve" means "act where allowed, propose where not". Returns a short
 * outcome summary the caller stores on the dispatched-task record.
 */
export async function resolveDispatchedTask(
  orchestrator: OrchestratorRow,
  taskText: string,
): Promise<{ runId: string; status: "success" | "failed"; summary: string; error?: string }> {
  const db = createAdminClient();
  const startedAt = new Date();

  const { data: runRow } = await db
    .from("orchestrator_runs")
    .insert({
      orchestrator_id: orchestrator.id,
      trigger: "manual",
      trigger_reason: `dispatched task: ${taskText.slice(0, 200)}`,
      status: "running",
      started_at: startedAt.toISOString(),
    })
    .select("id")
    .single();
  const runId = (runRow?.id as string) ?? "";

  try {
    const ctx: ToolContext = {
      tripId: orchestrator.trip_id,
      orchestratorId: orchestrator.id,
      actorKey: ORCH_ACTOR,
    };
    const autonomy = orchestrator.tool_autonomy ?? {};
    const tripCtx = await buildTripContext(orchestrator.trip_id);
    const base = buildSystemPrompt(orchestrator, tripCtx, autonomy, "manual", taskText);
    const dynamicContext = [
      "A trip member has DISPATCHED one specific task for you to resolve right now:",
      `  "${taskText}"`,
      "Take concrete action with your tools to resolve it this run. Where a tool's",
      "autonomy is propose_only, propose the change; otherwise apply it. Ignore the",
      "plan work-queue below for this run — focus only on the dispatched task — but",
      "use the trip context for grounding. Finish with a one-sentence summary of",
      "what you did.",
      "",
      base.dynamicContext,
    ].join("\n");

    const { calls, finalText } = await driveToolLoop({
      staticInstruction: base.staticInstruction,
      dynamicContext,
      promptId: base.promptId,
      promptHash: base.promptHash,
      tripId: orchestrator.trip_id,
      ctx,
      autonomy,
      runId,
    });

    const summary = buildSummaryLine(calls, finalText);
    const counts = countByStatus(calls);
    const finishedAt = new Date();
    await db
      .from("orchestrator_runs")
      .update({
        status: "success",
        summary,
        transcript: { calls, finalText } as unknown as Record<string, unknown>,
        finished_at: finishedAt.toISOString(),
        duration_ms: finishedAt.getTime() - startedAt.getTime(),
        tool_call_count: calls.length,
        applied_count: counts.applied + counts.auto_applied,
        proposed_count: counts.pending,
      })
      .eq("id", runId);

    return { runId, status: "success", summary };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    captureError(err, { context: "orchestrator_dispatched_task", orchestrator_id: orchestrator.id });
    if (runId) {
      await db
        .from("orchestrator_runs")
        .update({
          status: "failed",
          error: msg,
          finished_at: new Date().toISOString(),
          duration_ms: Date.now() - startedAt.getTime(),
        })
        .eq("id", runId);
    }
    return { runId, status: "failed", summary: `Failed: ${msg}`, error: msg };
  }
}

// ─── LLM loop ────────────────────────────────────────────────────────────────

interface DriveArgs {
  staticInstruction: string;
  dynamicContext: string;
  promptId?: string;
  promptHash?: string;
  tripId: string;
  ctx: ToolContext;
  autonomy: ToolAutonomyMap;
  runId: string;
}

async function driveToolLoop(args: DriveArgs): Promise<{ calls: ToolCallRecord[]; finalText: string }> {
  const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  const model = getModel();
  const tools = listTools();
  const functionDeclarations = tools.map(toFunctionDeclaration);

  // The dynamic per-run context goes in the first user turn so the static
  // systemInstruction stays byte-stable across runs — Gemini's implicit
  // context cache hits on stable prefixes, so this turns the rules +
  // playbook + tool registry into cacheable tokens across the auto-chain
  // (4 chained runs × MAX_TURNS=8 = up to 32 repeats per trip per hour).
  const contents: Content[] = [
    {
      role: "user",
      parts: [{ text: `${args.dynamicContext}\n\nBegin. Use the tools as needed, then summarize what you did.` }],
    },
  ];
  const calls: ToolCallRecord[] = [];
  let finalText = "";

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    let response;
    const turnStarted = Date.now();
    try {
      response = await client.models.generateContent({
        model,
        contents,
        config: {
          systemInstruction: args.staticInstruction,
          tools: [{ functionDeclarations }],
          toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO } },
        },
      });
    } catch (err) {
      await recordLlmCall({
        provider: "gemini",
        model,
        taskClass: "orchestrator",
        promptId: args.promptId,
        promptHash: args.promptHash,
        latencyMs: Date.now() - turnStarted,
        status: err instanceof GeminiUnavailableError ? "circuit_open" : "error",
        error: err instanceof Error ? err.message : String(err),
        tripId: args.tripId,
        orchestratorRunId: args.runId,
        metadata: { turn },
      });
      if (err instanceof GeminiUnavailableError) throw err;
      throw err instanceof Error ? err : new Error(String(err));
    }

    const usage = (response as { usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; cachedContentTokenCount?: number } }).usageMetadata;
    await recordLlmCall({
      provider: "gemini",
      model,
      taskClass: "orchestrator",
      promptId: args.promptId,
      promptHash: args.promptHash,
      tokensIn: usage?.promptTokenCount,
      tokensOut: usage?.candidatesTokenCount,
      cachedTokensIn: usage?.cachedContentTokenCount,
      latencyMs: Date.now() - turnStarted,
      status: "ok",
      tripId: args.tripId,
      orchestratorRunId: args.runId,
      metadata: { turn, function_calls: response.functionCalls?.length ?? 0 },
    });

    const fnCalls = response.functionCalls ?? [];
    if (fnCalls.length === 0) {
      finalText = (response.text ?? "").trim();
      break;
    }

    // Echo the model's call message into the transcript so subsequent turns
    // see the function_call → function_response pairing.
    contents.push({
      role: "model",
      parts: fnCalls.map((c) => ({ functionCall: c })),
    });

    const responseParts: Content["parts"] = [];
    for (const call of fnCalls) {
      const { record, modelResponse } = await dispatchCall(call, args);
      calls.push(record);
      responseParts.push({
        functionResponse: { name: call.name ?? "", response: modelResponse },
      });
    }

    contents.push({ role: "user", parts: responseParts });
  }

  return { calls, finalText };
}

async function dispatchCall(
  call: FunctionCall,
  args: DriveArgs,
): Promise<{ record: ToolCallRecord; modelResponse: Record<string, unknown> }> {
  const name = call.name ?? "";
  const tool = getTool(name);
  if (!tool) {
    return {
      record: {
        tool: name,
        args: (call.args as Record<string, unknown>) ?? {},
        status: "failed",
        summary: `Unknown tool: ${name}`,
        error: "UNKNOWN_TOOL",
      },
      modelResponse: { ok: false, error: "UNKNOWN_TOOL" },
    };
  }

  const parsed = tool.args.safeParse(call.args ?? {});
  if (!parsed.success) {
    return {
      record: {
        tool: name,
        args: (call.args as Record<string, unknown>) ?? {},
        status: "failed",
        summary: `Invalid args for ${name}`,
        error: parsed.error.message,
      },
      modelResponse: { ok: false, error: "INVALID_ARGS", detail: parsed.error.message },
    };
  }

  const autonomy: AgentAutonomy = args.autonomy[name] ?? tool.defaultAutonomy;
  const argsJson = JSON.parse(JSON.stringify(parsed.data)) as Record<string, unknown>;

  if (autonomy === "propose_only") {
    const preview = tool.dryDescribe(parsed.data);
    const actionId = await persistAction({
      runId: args.runId,
      ctx: args.ctx,
      tool: name,
      args: argsJson,
      autonomy,
      status: "pending",
      summary: preview,
    });
    return {
      record: { tool: name, args: argsJson, status: "pending", summary: preview, actionId },
      modelResponse: { ok: true, mode: "proposed", actionId, preview },
    };
  }

  try {
    const result = await tool.execute(args.ctx, parsed.data);
    const status: OrchestratorActionStatus = autonomy === "auto_apply" ? "auto_applied" : "applied";
    const actionId = await persistAction({
      runId: args.runId,
      ctx: args.ctx,
      tool: name,
      args: argsJson,
      autonomy,
      status,
      summary: result.summary,
      result: result.data ?? null,
      target: result.target ?? null,
    });
    return {
      record: { tool: name, args: argsJson, status, summary: result.summary, actionId },
      modelResponse: { ok: true, mode: status, actionId, result: result.data ?? null },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const actionId = await persistAction({
      runId: args.runId,
      ctx: args.ctx,
      tool: name,
      args: argsJson,
      autonomy,
      status: "failed",
      summary: `Failed: ${msg}`,
    });
    return {
      record: { tool: name, args: argsJson, status: "failed", summary: msg, actionId, error: msg },
      modelResponse: { ok: false, error: msg },
    };
  }
}

// ─── persistence ─────────────────────────────────────────────────────────────

interface PersistArgs {
  runId: string;
  ctx: ToolContext;
  tool: string;
  args: Record<string, unknown>;
  autonomy: AgentAutonomy;
  status: OrchestratorActionStatus;
  summary: string;
  result?: Record<string, unknown> | null;
  target?: { table: string; id: string; op: "insert" | "update" | "delete"; before?: Record<string, unknown> | null } | null;
}

async function persistAction(p: PersistArgs): Promise<string> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("orchestrator_actions")
    .insert({
      orchestrator_id: p.ctx.orchestratorId,
      run_id: p.runId,
      trip_id: p.ctx.tripId,
      tool: p.tool,
      input: p.args,
      result: p.result ?? null,
      rationale: p.summary,
      status: p.status,
      autonomy: p.autonomy,
      target: p.target ?? null,
    })
    .select("id")
    .single();
  if (error || !data) {
    captureError(error ?? new Error("persistAction failed"), {
      context: "orchestrator_runner",
      tool: p.tool,
    });
    return "";
  }
  return data.id as string;
}

// ─── prompt + context ────────────────────────────────────────────────────────

interface TripContext {
  destinationName: string | null;
  startDate: string | null;
  endDate: string | null;
  status: string | null;
  itemCount: number;
  pendingItemCount: number;
  recentItems: Array<{ id: string; title: string; stage: string }>;
  recentIdeas: Array<{ id: string; text: string }>;
  pendingProposals: Array<{ id: string; tool: string; summary: string }>;
  recentMemberMessages: Array<{ author: string; text: string; at: string }>;
  existingPackLabels: string[];
}

async function buildTripContext(tripId: string): Promise<TripContext> {
  const db = createAdminClient();
  const [{ data: trip }, { data: items }, { data: ideas }, { data: pending }, { data: msgs }, { data: packs }] = await Promise.all([
    db.from("trips").select("destination_name, start_date, end_date, status").eq("id", tripId).single(),
    db
      .from("trip_items")
      .select("id, title, stage")
      .eq("trip_id", tripId)
      .order("updated_at", { ascending: false })
      .limit(20),
    db
      .from("trip_ideas")
      .select("id, text")
      .eq("trip_id", tripId)
      .order("created_at", { ascending: false })
      .limit(10),
    db
      .from("orchestrator_actions")
      .select("id, tool, rationale")
      .eq("trip_id", tripId)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(15),
    db
      .from("trip_chat_messages")
      .select(
        "content, created_at, sender_kind, sender:app_users(display_name), thread:trip_chat_threads!inner(trip_id, kind)",
      )
      .eq("thread.trip_id", tripId)
      .eq("thread.kind", "group")
      .order("created_at", { ascending: false })
      .limit(8),
    db
      .from("packing_items")
      .select("label")
      .eq("trip_id", tripId)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  return {
    destinationName: (trip?.destination_name as string | null) ?? null,
    startDate: (trip?.start_date as string | null) ?? null,
    endDate: (trip?.end_date as string | null) ?? null,
    status: (trip?.status as string | null) ?? null,
    itemCount: items?.length ?? 0,
    pendingItemCount: (items ?? []).filter((i) => i.stage === "pending").length,
    recentItems: (items ?? []).slice(0, 10).map((i) => ({
      id: i.id as string,
      title: i.title as string,
      stage: i.stage as string,
    })),
    recentIdeas: (ideas ?? []).map((i) => ({ id: i.id as string, text: i.text as string })),
    pendingProposals: (pending ?? []).map((p) => ({
      id: p.id as string,
      tool: p.tool as string,
      summary: (p.rationale as string) ?? "",
    })),
    recentMemberMessages: (msgs ?? []).reverse().map((m) => {
      const sender = Array.isArray(m.sender) ? m.sender[0] : m.sender;
      return {
        author:
          m.sender_kind === "agent"
            ? "AI planner"
            : ((sender?.display_name as string) ?? "member"),
        text: (m.content as string) ?? "",
        at: (m.created_at as string) ?? "",
      };
    }),
    existingPackLabels: (packs ?? []).map((p) => p.label as string),
  };
}

interface BuiltPrompt {
  staticInstruction: string;
  dynamicContext: string;
  promptId: string;
  promptHash: string;
}

function buildSystemPrompt(
  orch: OrchestratorRow,
  ctx: TripContext,
  autonomy: ToolAutonomyMap,
  trigger: OrchestratorTrigger,
  triggerReason: string | undefined,
): BuiltPrompt {
  const goal = orch.system_goal?.trim() || "Help the group plan and execute this trip end-to-end.";
  const dial = listTools()
    .map((t) => `  - ${t.name}: ${autonomy[t.name] ?? t.defaultAutonomy}`)
    .join("\n");
  const agents = listCustomGridAgents()
    .map((a) => `  - ${a.type}: ${a.label} — ${a.description}`)
    .join("\n");
  const memoryObj = orch.memory ?? {};
  type PromptTask = {
    id: string;
    title: string;
    done: boolean;
    outcomeSummary?: string;
    tools?: string[];
  };
  type PromptPlan = {
    categories: Array<{ id: string; title: string; summary?: string; tasks: PromptTask[] }>;
  };
  const plan = (
    memoryObj as {
      plan?: {
        categories: Array<{
          id: string;
          title: string;
          summary?: string;
          tasks: Array<{
            id: string;
            title: string;
            done: boolean;
            outcome?: { summary: string };
            tools?: string[];
          }>;
        }>;
      };
    }
  ).plan as PromptPlan | undefined;
  const planLine = plan
    ? `${plan.categories.length} categories, ${plan.categories.reduce((n, c) => n + c.tasks.length, 0)} tasks (${plan.categories.reduce((n, c) => n + c.tasks.filter((t) => t.done).length, 0)} done)`
    : "(no plan yet)";
  const undoneTasks: Array<{ categoryId: string; categoryTitle: string; task: PromptTask }> = [];
  const doneTasks: Array<{ categoryTitle: string; task: PromptTask }> = [];
  if (plan) {
    for (const c of plan.categories) {
      for (const t of c.tasks) {
        const promptTask: PromptTask = {
          id: t.id,
          title: t.title,
          done: t.done,
          outcomeSummary: (t as unknown as { outcome?: { summary: string } }).outcome?.summary,
          tools: t.tools,
        };
        if (t.done) doneTasks.push({ categoryTitle: c.title, task: promptTask });
        else undoneTasks.push({ categoryId: c.id, categoryTitle: c.title, task: promptTask });
      }
    }
  }
  const undoneList = undoneTasks.length === 0
    ? "  (all done — nothing to work on)"
    : undoneTasks
        .slice(0, 25)
        .map((u) => {
          const bound = u.task.tools && u.task.tools.length > 0
            ? ` — tools: ${u.task.tools.join(", ")}`
            : " — tools: (unbounded — bind on next plan.upsert)";
          return `  - [${u.categoryId}/${u.task.id}] ${u.categoryTitle} · ${u.task.title}${bound}`;
        })
        .join("\n");
  const doneList = doneTasks.length === 0
    ? "  (none yet)"
    : doneTasks
        .slice(0, 15)
        .map((d) => `  - ${d.categoryTitle} · ${d.task.title}${d.task.outcomeSummary ? ` — ${d.task.outcomeSummary}` : ""}`)
        .join("\n");
  // Strip plan from the JSON memory dump — it's already rendered above.
  const memoryForPrompt = Object.fromEntries(
    Object.entries(memoryObj).filter(([k]) => k !== "plan"),
  );
  const memory = JSON.stringify(memoryForPrompt);
  const pending = ctx.pendingProposals.length === 0
    ? "  (none)"
    : ctx.pendingProposals.map((p) => `  - [${p.id.slice(0, 8)}] ${p.tool}: ${p.summary}`).join("\n");
  const items = ctx.recentItems.length === 0
    ? "  (no board items yet)"
    : ctx.recentItems.map((i) => `  - [${i.id.slice(0, 8)}] (${i.stage}) ${i.title}`).join("\n");
  const ideas = ctx.recentIdeas.length === 0
    ? "  (no ideas yet)"
    : ctx.recentIdeas.map((i) => `  - [${i.id.slice(0, 8)}] ${i.text}`).join("\n");
  const msgs = ctx.recentMemberMessages.length === 0
    ? "  (no recent chat)"
    : ctx.recentMemberMessages.map((m) => `  - ${m.author}: ${m.text}`).join("\n");
  const packs = ctx.existingPackLabels.length === 0
    ? "  (none yet)"
    : `  ${ctx.existingPackLabels.slice(0, 30).join(", ")}`;

  // STATIC half — versioned in prompts/orchestrator/system.md. The tool +
  // agent lists are deploy-stable (change only when devs ship new tools), so
  // they live in the static block too. Concatenated body is content-hashed
  // so prompt diffs surface in llm_calls.prompt_hash.
  const registryPrompt = loadPrompt("orchestrator.system");
  const staticInstruction = [
    registryPrompt.body,
    "",
    "Registered tools (pick from these names when setting `tools` on a plan task):",
    `  ${listToolNames().join(", ")}`,
    "",
    "Custom-grid agents available for grids.add_agent:",
    agents,
    "",
    "Reading the group chat: members converse in a shared room and you see it under \"Recent member chat\". When the conversation reveals an ongoing, recurring need that one of the agents above covers — e.g. wanting to watch flight or hotel prices, check the weather for the trip dates, gather destination photos, or read group consensus — propose a matching grid with grids.add_agent (propose_only: the member confirms it). Propose at most one grid per run, only when the need is clear and not already covered by an existing or pending grid; never spam proposals for casual chat.",
  ].join("\n");

  // DYNAMIC half — per-run trip state. Goes into the first user turn so the
  // systemInstruction above stays byte-stable across the auto-chain.
  const dynamicContext = [
    `Goal: ${goal}`,
    `Trigger: ${trigger}${triggerReason ? ` (${triggerReason})` : ""}`,
    "",
    "Tool autonomy in effect:",
    dial,
    "",
    "Trip context:",
    `  destination: ${ctx.destinationName ?? "(unset)"}`,
    `  dates: ${ctx.startDate ?? "?"} → ${ctx.endDate ?? "?"}`,
    `  status: ${ctx.status ?? "?"}`,
    `  board items: ${ctx.itemCount} (pending votes: ${ctx.pendingItemCount})`,
    "",
    "Recent board items:",
    items,
    "",
    "Recent ideas:",
    ideas,
    "",
    "Pending proposals (already in the ghost lane — don't re-propose):",
    pending,
    "",
    "Recent member chat:",
    msgs,
    "",
    "Existing pack list (skip duplicates when adding):",
    packs,
    "",
    `Plan: ${planLine}`,
    "Undone tasks (your work queue — format [categoryId/taskId]):",
    undoneList,
    "",
    "Recently completed tasks:",
    doneList,
    "",
    `Long-running memory: ${memory}`,
  ].join("\n");

  return {
    staticInstruction,
    dynamicContext,
    promptId: registryPrompt.id,
    promptHash: registryPrompt.hash,
  };
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function toFunctionDeclaration(tool: ToolDefinition) {
  return {
    name: tool.name,
    description: tool.description,
    parametersJsonSchema: z.toJSONSchema(tool.args),
  };
}

function addMinutes(d: Date, m: number): Date {
  return new Date(d.getTime() + m * 60_000);
}

/**
 * Count undone tasks left on the orchestrator's plan after the current run.
 * Used to decide whether an auto-chain is worth scheduling.
 */
async function countUndoneTasks(orchestratorId: string): Promise<number> {
  const db = createAdminClient();
  const { data } = await db
    .from("trip_orchestrators")
    .select("memory")
    .eq("id", orchestratorId)
    .single();
  const plan = (data?.memory as { plan?: { categories: Array<{ tasks: Array<{ done: boolean }> }> } } | null)?.plan;
  if (!plan) return 0;
  let n = 0;
  for (const c of plan.categories) for (const t of c.tasks) if (!t.done) n++;
  return n;
}

/**
 * Schedule a follow-up orchestrator run via Next.js `after()`. Used to chain
 * runs immediately after a plan generation so the freshly listed tasks
 * start getting worked without waiting for the cron heartbeat. The chain
 * budget lives on the orchestrator's `memory.autoChainsRemaining` and is
 * decremented each chained run — when it hits zero, the runner falls back
 * to the normal schedule.
 */
function scheduleAutoChain(orchestratorId: string): void {
  try {
    after(async () => {
      try {
        const db = createAdminClient();
        const { data: fresh } = await db
          .from("trip_orchestrators")
          .select("id, trip_id, enabled, system_goal, tool_autonomy, schedule_minutes, memory, consecutive_failures")
          .eq("id", orchestratorId)
          .single();
        if (!fresh || !fresh.enabled) return;
        await runOrchestrator(
          {
            id: fresh.id as string,
            trip_id: fresh.trip_id as string,
            enabled: fresh.enabled as boolean,
            system_goal: (fresh.system_goal as string | null) ?? null,
            tool_autonomy: (fresh.tool_autonomy as ToolAutonomyMap | null) ?? null,
            schedule_minutes: fresh.schedule_minutes as number,
            memory: (fresh.memory as Record<string, unknown> | null) ?? null,
            consecutive_failures: fresh.consecutive_failures as number,
          },
          "event",
          "auto-chain",
        );
      } catch (err) {
        captureError(err, { context: "orchestrator_auto_chain", orchestrator_id: orchestratorId });
      }
    });
  } catch (err) {
    // `after()` throws when called outside a request scope (e.g. in unit
    // tests). The cron sweeper will still pick the run up via next_run_at,
    // so this is non-fatal.
    captureError(err, { context: "orchestrator_auto_chain_schedule", orchestrator_id: orchestratorId });
  }
}

function countByStatus(calls: ToolCallRecord[]): Record<OrchestratorActionStatus, number> {
  const c: Record<OrchestratorActionStatus, number> = {
    pending: 0, applied: 0, auto_applied: 0, dismissed: 0, undone: 0, failed: 0,
  };
  for (const x of calls) c[x.status]++;
  return c;
}

function buildSummaryLine(calls: ToolCallRecord[], finalText: string): string {
  if (calls.length === 0) return finalText || "No action needed this run.";
  const c = countByStatus(calls);
  const parts: string[] = [];
  if (c.applied + c.auto_applied > 0) parts.push(`${c.applied + c.auto_applied} applied`);
  if (c.pending > 0) parts.push(`${c.pending} proposed`);
  if (c.failed > 0) parts.push(`${c.failed} failed`);
  const counts = parts.join(", ");
  return finalText ? `${finalText} (${counts})` : counts;
}

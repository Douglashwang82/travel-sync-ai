import { z } from "zod";
import { GoogleGenAI, FunctionCallingConfigMode, type FunctionCall, type Content } from "@google/genai";
import { createAdminClient } from "@/lib/db";
import { captureError } from "@/lib/monitoring";
import { GeminiUnavailableError, getModel } from "@/lib/gemini";
import type { AgentAutonomy } from "@/services/agents/types";
import { listTools, getTool, listCustomGridAgents } from "./tools";
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
    const systemPrompt = buildSystemPrompt(orchestrator, context, autonomy, trigger, triggerReason);

    const { calls, finalText } = await driveToolLoop({
      systemPrompt,
      ctx,
      autonomy,
      runId,
    });

    const counts = countByStatus(calls);
    const finishedAt = new Date();
    const summary = buildSummaryLine(calls, finalText);

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

    await db
      .from("trip_orchestrators")
      .update({
        last_run_at: finishedAt.toISOString(),
        next_run_at: addMinutes(finishedAt, orchestrator.schedule_minutes).toISOString(),
        last_status: "success",
        last_summary: summary,
        last_error: null,
        consecutive_failures: 0,
        pending_reason: null,
        pending_trigger: null,
      })
      .eq("id", orchestrator.id);

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

// ─── LLM loop ────────────────────────────────────────────────────────────────

interface DriveArgs {
  systemPrompt: string;
  ctx: ToolContext;
  autonomy: ToolAutonomyMap;
  runId: string;
}

async function driveToolLoop(args: DriveArgs): Promise<{ calls: ToolCallRecord[]; finalText: string }> {
  const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  const model = getModel();
  const tools = listTools();
  const functionDeclarations = tools.map(toFunctionDeclaration);

  const contents: Content[] = [
    { role: "user", parts: [{ text: "Begin. Use the tools as needed, then summarize what you did." }] },
  ];
  const calls: ToolCallRecord[] = [];
  let finalText = "";

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    let response;
    try {
      response = await client.models.generateContent({
        model,
        contents,
        config: {
          systemInstruction: args.systemPrompt,
          tools: [{ functionDeclarations }],
          toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO } },
        },
      });
    } catch (err) {
      if (err instanceof GeminiUnavailableError) throw err;
      throw err instanceof Error ? err : new Error(String(err));
    }

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
}

async function buildTripContext(tripId: string): Promise<TripContext> {
  const db = createAdminClient();
  const [{ data: trip }, { data: items }, { data: ideas }, { data: pending }, { data: msgs }] = await Promise.all([
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
      .select("display_name, content, created_at")
      .eq("trip_id", tripId)
      .order("created_at", { ascending: false })
      .limit(8),
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
    recentMemberMessages: (msgs ?? []).reverse().map((m) => ({
      author: (m.display_name as string) ?? "member",
      text: (m.content as string) ?? "",
      at: (m.created_at as string) ?? "",
    })),
  };
}

function buildSystemPrompt(
  orch: OrchestratorRow,
  ctx: TripContext,
  autonomy: ToolAutonomyMap,
  trigger: OrchestratorTrigger,
  triggerReason: string | undefined,
): string {
  const goal = orch.system_goal?.trim() || "Help the group plan and execute this trip end-to-end.";
  const dial = listTools()
    .map((t) => `  - ${t.name}: ${autonomy[t.name] ?? t.defaultAutonomy}`)
    .join("\n");
  const agents = listCustomGridAgents()
    .map((a) => `  - ${a.type}: ${a.label} — ${a.description}`)
    .join("\n");
  const memoryObj = orch.memory ?? {};
  type PromptTask = { id: string; title: string; done: boolean; outcomeSummary?: string };
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
        .map((u) => `  - [${u.categoryId}/${u.task.id}] ${u.categoryTitle} · ${u.task.title}`)
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

  return [
    "You are the per-trip Orchestrator. You have the same surface area as a human member, exposed as tools.",
    "",
    `Goal: ${goal}`,
    `Trigger: ${trigger}${triggerReason ? ` (${triggerReason})` : ""}`,
    "",
    "Operating rules:",
    "  - The plan's undone tasks are your primary work queue. On each run: ensure a plan exists, then iterate the undone tasks and take concrete tool actions that advance them.",
    "  - Surface REAL options with links so the user can review and book. For any task involving restaurants, hotels, activities, or transport, call `places.search` first to get verified candidates (name, address, rating, photo, Google Maps URL). Then create a decision item (items.create with itemKind='decision') and attach 2–4 candidates via `items.add_option` — always include `googleMapsUrl`, and `bookingUrl` whenever you have one. Reservation/menu pages, official hotel sites, and ticketing pages all qualify as bookingUrl.",
    "  - For each task: do the work, then call `plan.update_task` with done=true (or done=false for partial progress) and an outcome { summary, links }. Each link is either internal (kind: 'item'|'idea'|'packItem'|'expense'|'customGrid'|'trip' + id) or external (kind: 'external' + url) — include external links for every booking/reservation/Maps URL so the user can act in one click. The bento grids read from the same tables your tools write to, so internal links sync automatically.",
    "  - Don't auto-mark a task done unless you actually took action for it this run. Never mark done a task that requires human input you don't have (e.g. confirming a booking, voting).",
    "  - Prefer the smallest useful change per task. Do at most 3–4 tasks per run; quality over quantity.",
    "  - Never call destructive tools (items.delete, items.confirm) unless you are certain — these are propose-only by default.",
    "  - For each tool call, the system enforces a per-tool autonomy dial. propose_only writes a proposal a human will Confirm/Dismiss; auto_apply* takes effect immediately. Don't fight the dial — call the tool either way.",
    "  - Don't repeat work that's already in pending proposals; build on them instead.",
    "  - Plan maintenance via `plan.upsert`: if no plan exists, generate one now (4–8 categories essential for THIS trip — e.g. Stay, Transport, Activities, Food, Budget, Pack, Docs — each with 2–6 concrete user-completable tasks). If a plan exists, only call `plan.upsert` when the trip's structure has materially changed; task done state and outcomes are preserved across upserts when titles match.",
    "  - When you're done, output a short final summary (≤2 sentences) of what you did and why.",
    "",
    "Tool autonomy in effect:",
    dial,
    "",
    "Custom-grid agents available for grids.add_agent:",
    agents,
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
    `Plan: ${planLine}`,
    "Undone tasks (your work queue — format [categoryId/taskId]):",
    undoneList,
    "",
    "Recently completed tasks:",
    doneList,
    "",
    `Long-running memory: ${memory}`,
  ].join("\n");
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

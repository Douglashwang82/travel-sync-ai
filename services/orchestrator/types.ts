import type { z } from "zod";
import type { AgentAutonomy } from "@/services/agents/types";

export type OrchestratorTrigger = "cron" | "event" | "manual";

export type OrchestratorActionStatus =
  | "pending"
  | "applied"
  | "auto_applied"
  | "dismissed"
  | "undone"
  | "failed";

/**
 * The orchestrator passes this to every tool. Tools never read autonomy or
 * decide whether to actually mutate — the runner inspects autonomy on the
 * way out and either persists a pending proposal (`propose_only`) or executes
 * the tool and logs an `applied`/`auto_applied` row.
 */
export interface ToolContext {
  tripId: string;
  orchestratorId: string;
  /** A best-effort actor: the orchestrator id, surfaced to downstream code that wants a "who" for provenance. */
  actorKey: string;
}

/**
 * What a tool returns after executing. `target` carries the primitives needed
 * to reverse the change later (`POST /actions/[id]/undo`).
 */
export interface ToolResult {
  /** Short human-readable line for the run summary / notification. */
  summary: string;
  /** Tool-specific structured output, persisted to `orchestrator_actions.result`. */
  data?: Record<string, unknown>;
  /** Undo metadata. Omit for tools that have no reversible effect (e.g. read tools, notifications). */
  target?: {
    table: string;
    id: string;
    op: "insert" | "update" | "delete";
    before?: Record<string, unknown> | null;
  };
}

/**
 * Definition of one tool. The `execute` function is invoked only when
 * autonomy permits — for `propose_only`, the runner skips execute() and
 * writes a pending row directly.
 *
 * `dryDescribe` lets a tool render a useful preview line for the pending
 * proposal without doing any work (e.g. "Add 'Visit Fushimi Inari' to ideas").
 */
// The schema type binds `dryDescribe` / `execute` to its inferred arg type
// while still letting the registry hold a heterogeneous list of tools.
export interface ToolDefinition<S extends z.ZodType = z.ZodType> {
  /** Registry key, e.g. "items.create". Persisted in `orchestrator_actions.tool`. */
  name: string;
  /** Shown to the LLM. Keep imperative + short. */
  description: string;
  /** Bento grid this tool belongs to — used for UI grouping in the autonomy editor. */
  grid: ToolGrid;
  /** What the safest default autonomy looks like for this tool. */
  defaultAutonomy: AgentAutonomy;
  /** Zod schema for `args`. Converted to JSON Schema for Gemini function declarations. */
  args: S;
  /** Render a one-line proposal preview. Called even in propose_only mode. */
  dryDescribe(args: z.infer<S>): string;
  /** Execute the side effect. Only called when autonomy allows it. */
  execute(ctx: ToolContext, args: z.infer<S>): Promise<ToolResult>;
}

/** Type-narrowing helper so each tool literal keeps its inferred args type. */
export function defineTool<S extends z.ZodType>(t: ToolDefinition<S>): ToolDefinition<S> {
  return t;
}

export type ToolGrid =
  | "items"        // tasks / itinerary / plan-master
  | "ideas"
  | "votes"
  | "pack"
  | "budget"
  | "members"
  | "shared"
  | "trip"         // hero / metadata
  | "chat"
  | "grids"        // custom-grid CRUD
  | "plan";        // structural trip plan (Orchestrator mode)

// ─── plan (Orchestrator-mode plan tree) ──────────────────────────────────────
// Stored on `trip_orchestrators.memory.plan`. The orchestrator owns this
// structure; users can toggle task completion but the categories themselves
// are LLM-generated and overwritten on each `plan.upsert`.

export interface PlanTaskLink {
  /**
   * Which bento grid the linked entity lives in, or "external" for an
   * outbound URL (booking page, restaurant site, Google Maps listing, etc.).
   */
  kind: "item" | "idea" | "packItem" | "expense" | "customGrid" | "trip" | "external";
  /** Primary key of the linked row, when the kind refers to an internal entity. */
  id?: string;
  /** Outbound URL — required for `external`, optional context for other kinds (e.g. booking URL for an option). */
  url?: string;
  /** Optional short label shown next to the chip. */
  label?: string;
}

export interface PlanTaskOutcome {
  /** One-line description of what the orchestrator did. */
  summary: string;
  /** References to entities the orchestrator created/affected for this task. */
  links: PlanTaskLink[];
  /** ISO timestamp the outcome was recorded. */
  completedAt: string;
}

export interface PlanTask {
  id: string;
  title: string;
  done: boolean;
  note?: string;
  /** Recorded outcome from the orchestrator when it worked on this task. */
  outcome?: PlanTaskOutcome;
}

export interface PlanCategory {
  id: string;
  title: string;
  summary?: string;
  tasks: PlanTask[];
}

export interface TripPlan {
  generatedAt: string;
  categories: PlanCategory[];
}

export interface ToolCallRecord {
  tool: string;
  args: Record<string, unknown>;
  status: OrchestratorActionStatus;
  summary: string;
  rationale?: string;
  error?: string;
  actionId?: string;
}

export interface OrchestratorRunSummary {
  runId: string;
  status: "success" | "failed" | "skipped";
  proposed: number;
  applied: number;
  failed: number;
  summary: string;
  error?: string;
}

export type ToolAutonomyMap = Record<string, AgentAutonomy>;

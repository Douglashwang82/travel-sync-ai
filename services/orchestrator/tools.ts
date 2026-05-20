import { z } from "zod";
import { createAdminClient } from "@/lib/db";
import { pushText } from "@/lib/line";
import {
  createItem,
  updateItem,
  moveItemStage,
  confirmItem,
  reopenItem,
  deleteItem,
  startVote,
  addOption,
} from "@/services/trip-state";
import { recordExpense, getAllMemberBeneficiaries } from "@/services/expenses";
import type { ItemStage, ItemType } from "@/lib/types";
import { listAgents, getAgent } from "@/services/agents/registry";
import { runCustomGrid, type CustomGridRow } from "@/services/agents/runner";
import { defineTool, type ToolDefinition, type ToolContext } from "./types";

/**
 * The orchestrator's tool registry. One tool per atomic user action across
 * the bento grids. Tools call into the existing service layer so the same
 * invariants (idempotency, atomic confirm, booking_status derivation, etc.)
 * apply to orchestrator writes as to manual ones.
 *
 * The runner enforces autonomy — tools just execute when invoked.
 */

const ITEM_TYPES = ["activity", "hotel", "restaurant", "transport", "flight", "insurance", "other"] as const satisfies readonly ItemType[];
const ITEM_STAGES = ["todo", "pending", "confirmed"] as const satisfies readonly ItemStage[];

// ─── items.* ─────────────────────────────────────────────────────────────────

const itemsCreate = defineTool({
  name: "items.create",
  description:
    "Add a new item to the trip's To-Do board. Used for tasks, activities, restaurants, hotels, flights, and transport. Set itemKind='decision' when the group needs to vote between options.",
  grid: "items",
  defaultAutonomy: "propose_only",
  args: z.object({
    title: z.string().min(1).max(200),
    itemType: z.enum(ITEM_TYPES).optional(),
    itemKind: z.enum(["task", "decision"]).optional(),
    description: z.string().max(2000).optional(),
    deadlineAt: z.string().datetime().optional(),
  }),
  dryDescribe: (a) => `Add board item: "${a.title}"`,
  async execute(ctx, a) {
    const r = await createItem({
      tripId: ctx.tripId,
      title: a.title,
      itemType: a.itemType,
      itemKind: a.itemKind,
      description: a.description,
      source: "ai",
      sourceAgent: ctx.actorKey,
      deadlineAt: a.deadlineAt,
    });
    if (!r.ok) throw new Error(r.error);
    return {
      summary: `Created board item "${a.title}"`,
      data: { itemId: r.item.id },
      target: { table: "trip_items", id: r.item.id, op: "insert" },
    };
  },
});

const itemsUpdate = defineTool({
  name: "items.update",
  description: "Update a board item's title, description, type, or deadline.",
  grid: "items",
  defaultAutonomy: "propose_only",
  args: z.object({
    itemId: z.uuid(),
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(2000).optional(),
    itemType: z.enum(ITEM_TYPES).optional(),
    deadlineAt: z.string().nullable().optional(),
  }),
  dryDescribe: (a) => `Update item ${a.itemId.slice(0, 8)}…`,
  async execute(_ctx, a) {
    const before = await snapshot("trip_items", a.itemId);
    const r = await updateItem(a.itemId, {
      title: a.title,
      description: a.description,
      itemType: a.itemType,
      deadlineAt: a.deadlineAt ?? undefined,
    });
    if (!r.ok) throw new Error(r.error);
    return {
      summary: `Updated "${r.item.title}"`,
      data: { itemId: r.item.id },
      target: { table: "trip_items", id: r.item.id, op: "update", before },
    };
  },
});

const itemsMoveStage = defineTool({
  name: "items.move_stage",
  description:
    "Move a board item between stages (todo, pending, confirmed). For decisions, prefer items.start_vote / items.confirm instead.",
  grid: "items",
  defaultAutonomy: "propose_only",
  args: z.object({ itemId: z.uuid(), stage: z.enum(ITEM_STAGES) }),
  dryDescribe: (a) => `Move item to ${a.stage}`,
  async execute(_ctx, a) {
    const before = await snapshot("trip_items", a.itemId);
    const r = await moveItemStage(a.itemId, a.stage);
    if (!r.ok) throw new Error(r.error);
    return {
      summary: `Moved "${r.item.title}" → ${a.stage}`,
      data: { itemId: r.item.id, stage: a.stage },
      target: { table: "trip_items", id: r.item.id, op: "update", before },
    };
  },
});

const itemsStartVote = defineTool({
  name: "items.start_vote",
  description:
    "Open voting on a decision item. Members will be able to vote among the item's options; the vote auto-closes at deadlineAt.",
  grid: "items",
  defaultAutonomy: "propose_only",
  args: z.object({ itemId: z.uuid(), deadlineAt: z.string().datetime() }),
  dryDescribe: (a) => `Start vote on item ${a.itemId.slice(0, 8)}…`,
  async execute(_ctx, a) {
    const before = await snapshot("trip_items", a.itemId);
    const r = await startVote(a.itemId, a.deadlineAt);
    if (!r.ok) throw new Error(r.error);
    return {
      summary: `Opened voting on "${r.item.title}"`,
      data: { itemId: r.item.id, deadlineAt: a.deadlineAt },
      target: { table: "trip_items", id: r.item.id, op: "update", before },
    };
  },
});

const itemsAddOption = defineTool({
  name: "items.add_option",
  description: "Add a voteable option to a decision item (e.g. a candidate hotel or restaurant).",
  grid: "items",
  defaultAutonomy: "propose_only",
  args: z.object({ itemId: z.uuid(), name: z.string().min(1).max(160) }),
  dryDescribe: (a) => `Add option "${a.name}"`,
  async execute(_ctx, a) {
    const r = await addOption({ itemId: a.itemId, name: a.name });
    if (!r.ok) throw new Error(r.error);
    return {
      summary: `Added option "${a.name}"`,
      data: { optionId: r.optionId },
      target: { table: "trip_item_options", id: r.optionId, op: "insert" },
    };
  },
});

const itemsConfirm = defineTool({
  name: "items.confirm",
  description: "Confirm a decision item with a specific option as the winner.",
  grid: "items",
  // Confirming books a slot — always require human review by default.
  defaultAutonomy: "propose_only",
  args: z.object({ itemId: z.uuid(), optionId: z.uuid() }),
  dryDescribe: (a) => `Confirm item ${a.itemId.slice(0, 8)} with option ${a.optionId.slice(0, 8)}`,
  async execute(_ctx, a) {
    const before = await snapshot("trip_items", a.itemId);
    const r = await confirmItem(a.itemId, a.optionId);
    if (!r.ok) throw new Error(r.error);
    return {
      summary: `Confirmed "${r.item.title}"`,
      data: { itemId: r.item.id, optionId: a.optionId },
      target: { table: "trip_items", id: r.item.id, op: "update", before },
    };
  },
});

const itemsReopen = defineTool({
  name: "items.reopen",
  description: "Reopen a confirmed or pending item back to todo.",
  grid: "items",
  defaultAutonomy: "propose_only",
  args: z.object({ itemId: z.uuid() }),
  dryDescribe: (a) => `Reopen item ${a.itemId.slice(0, 8)}…`,
  async execute(_ctx, a) {
    const before = await snapshot("trip_items", a.itemId);
    const r = await reopenItem(a.itemId);
    if (!r.ok) throw new Error(r.error);
    return {
      summary: `Reopened "${r.item.title}"`,
      data: { itemId: r.item.id },
      target: { table: "trip_items", id: r.item.id, op: "update", before },
    };
  },
});

const itemsDelete = defineTool({
  name: "items.delete",
  description: "Permanently delete a board item. Cannot be undone after the proposal is dismissed.",
  grid: "items",
  defaultAutonomy: "propose_only",
  args: z.object({ itemId: z.uuid() }),
  dryDescribe: (a) => `Delete item ${a.itemId.slice(0, 8)}…`,
  async execute(_ctx, a) {
    const before = await snapshot("trip_items", a.itemId);
    const r = await deleteItem(a.itemId);
    if (!r.ok) throw new Error(r.error ?? "delete failed");
    return {
      summary: `Deleted item ${a.itemId.slice(0, 8)}`,
      data: { itemId: a.itemId },
      target: { table: "trip_items", id: a.itemId, op: "delete", before },
    };
  },
});

// ─── ideas.* ─────────────────────────────────────────────────────────────────

const ideasAdd = defineTool({
  name: "ideas.add",
  description:
    "Add a lightweight idea to the Ideas grid. Use for inspiration that hasn't reached the To-Do board yet — restaurants to consider, day-trip suggestions, neighborhoods to explore.",
  grid: "ideas",
  // Ideas are non-destructive; safe to apply by default.
  defaultAutonomy: "auto_apply_with_undo",
  args: z.object({
    text: z.string().min(1).max(400),
    category: z.enum(["activity", "restaurant", "hotel", "general"]).optional(),
  }),
  dryDescribe: (a) => `Add idea: "${a.text.slice(0, 80)}"`,
  async execute(ctx, a) {
    const db = createAdminClient();
    const { data: trip } = await db.from("trips").select("group_id").eq("id", ctx.tripId).single();
    if (!trip?.group_id) throw new Error("Trip has no group; ideas require a group");
    const { data, error } = await db
      .from("trip_ideas")
      .insert({
        trip_id: ctx.tripId,
        group_id: trip.group_id,
        submitted_by: `agent:${ctx.actorKey}`,
        display_name: "Orchestrator",
        category: a.category ?? "general",
        text: a.text,
        source_agent: ctx.actorKey,
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(error?.message ?? "failed to insert idea");
    return {
      summary: `Added idea: "${a.text.slice(0, 60)}"`,
      data: { ideaId: data.id },
      target: { table: "trip_ideas", id: data.id as string, op: "insert" },
    };
  },
});

// ─── pack.* ──────────────────────────────────────────────────────────────────

const PACK_CATEGORIES = ["essentials", "clothing", "toiletries", "electronics", "documents", "general"] as const;

const packAdd = defineTool({
  name: "pack.add",
  description: "Add a group packing-list item. Use for shared things ('first-aid kit', 'sunblock').",
  grid: "pack",
  defaultAutonomy: "auto_apply_with_undo",
  args: z.object({
    label: z.string().min(1).max(120),
    category: z.enum(PACK_CATEGORIES).optional(),
  }),
  dryDescribe: (a) => `Add to pack list: "${a.label}"`,
  async execute(ctx, a) {
    const db = createAdminClient();
    const { data, error } = await db
      .from("packing_items")
      .insert({
        trip_id: ctx.tripId,
        label: a.label,
        category: a.category ?? "general",
        added_by: `agent:${ctx.actorKey}`,
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(error?.message ?? "failed to insert pack item");
    return {
      summary: `Added "${a.label}" to packing list`,
      data: { packItemId: data.id },
      target: { table: "packing_items", id: data.id as string, op: "insert" },
    };
  },
});

// ─── budget.* ────────────────────────────────────────────────────────────────

const expensesRecord = defineTool({
  name: "expenses.record",
  description:
    "Log a paid expense and split it. When splitWithLineUserIds is omitted, splits across all group members. Amounts in trip currency.",
  grid: "budget",
  // Money is sensitive — keep a human in the loop by default.
  defaultAutonomy: "propose_only",
  args: z.object({
    amount: z.number().positive(),
    description: z.string().min(1).max(200),
    paidByLineUserId: z.string().min(1),
    paidByDisplayName: z.string().optional(),
    splitWithLineUserIds: z.array(z.string()).optional(),
  }),
  dryDescribe: (a) => `Record expense ${a.amount} — ${a.description}`,
  async execute(ctx, a) {
    const db = createAdminClient();
    const { data: trip } = await db
      .from("trips")
      .select("group_id")
      .eq("id", ctx.tripId)
      .single();
    if (!trip?.group_id) throw new Error("Trip has no group; expense requires a group");

    let beneficiaries = a.splitWithLineUserIds?.length
      ? a.splitWithLineUserIds.map((id) => ({ userId: id, displayName: id }))
      : await getAllMemberBeneficiaries(trip.group_id);

    if (beneficiaries.length === 0) {
      beneficiaries = [{ userId: a.paidByLineUserId, displayName: a.paidByDisplayName ?? a.paidByLineUserId }];
    }

    const { id } = await recordExpense({
      groupId: trip.group_id,
      tripId: ctx.tripId,
      paidByUserId: a.paidByLineUserId,
      paidByDisplayName: a.paidByDisplayName ?? null,
      amount: a.amount,
      description: a.description,
      beneficiaries,
    });
    return {
      summary: `Recorded expense: ${a.description} (${a.amount})`,
      data: { expenseId: id },
      target: { table: "expenses", id, op: "insert" },
    };
  },
});

// ─── chat.* ──────────────────────────────────────────────────────────────────

const chatNotify = defineTool({
  name: "chat.notify_group",
  description:
    "Push a short message to the trip's LINE group. Use sparingly — only for status updates the group actually needs.",
  grid: "chat",
  // Pushing messages to a chat is socially expensive; default to propose-only.
  defaultAutonomy: "propose_only",
  args: z.object({ text: z.string().min(1).max(800) }),
  dryDescribe: (a) => `Notify group: "${a.text.slice(0, 80)}"`,
  async execute(ctx, a) {
    const db = createAdminClient();
    const { data: trip } = await db
      .from("trips")
      .select("group_id, line_groups(line_group_id)")
      .eq("id", ctx.tripId)
      .single();
    const lineGroupId = (
      trip?.line_groups as { line_group_id?: string } | { line_group_id?: string }[] | null
    );
    const target =
      Array.isArray(lineGroupId)
        ? lineGroupId[0]?.line_group_id
        : lineGroupId?.line_group_id;
    if (!target) throw new Error("Trip has no LINE group to notify");
    await pushText(target, a.text, (trip?.group_id as string) ?? undefined);
    return {
      summary: `Posted to group: "${a.text.slice(0, 60)}"`,
      data: { text: a.text },
      // No undo for sent messages.
    };
  },
});

// ─── grids.* ─────────────────────────────────────────────────────────────────

const gridsAddAgent = defineTool({
  name: "grids.add_agent",
  description:
    "Add a new custom bento grid backed by one of the predefined agents (flight_price_tracker, weather_forecast, hotel_price_watch, chat_digest, packing_suggester, itinerary_drafter, consensus_radar, social_media_photos).",
  grid: "grids",
  defaultAutonomy: "propose_only",
  args: z.object({
    agentType: z.string().min(1),
    title: z.string().min(1).max(80),
    config: z.record(z.string(), z.unknown()),
    frequencyHours: z.number().int().min(1).max(24 * 14).optional(),
  }),
  dryDescribe: (a) => `Add custom grid "${a.title}" (${a.agentType})`,
  async execute(ctx, a) {
    const agent = getAgent(a.agentType);
    if (!agent) throw new Error(`Unknown agent_type: ${a.agentType}`);
    const parsed = agent.configSchema.safeParse(a.config);
    if (!parsed.success) {
      throw new Error(`Invalid config for ${a.agentType}: ${parsed.error.message}`);
    }

    const db = createAdminClient();
    // Synthetic created_by — the orchestrator owns these. We piggyback on the
    // trip's organizer if available so the row passes any owner-based checks.
    const { data: trip } = await db
      .from("trips")
      .select("created_by_user_id")
      .eq("id", ctx.tripId)
      .single();
    const { data: organizer } = trip?.created_by_user_id
      ? await db
          .from("app_users")
          .select("id")
          .eq("line_user_id", trip.created_by_user_id)
          .maybeSingle()
      : { data: null };
    if (!organizer?.id) {
      throw new Error("Cannot resolve a creator for the custom grid");
    }

    const { data, error } = await db
      .from("custom_grids")
      .insert({
        trip_id: ctx.tripId,
        created_by: organizer.id as string,
        agent_type: a.agentType,
        title: a.title,
        config: parsed.data as Record<string, unknown>,
        frequency_hours: a.frequencyHours ?? agent.defaultFrequencyHours,
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(error?.message ?? "failed to add grid");
    return {
      summary: `Added grid "${a.title}"`,
      data: { customGridId: data.id },
      target: { table: "custom_grids", id: data.id as string, op: "insert" },
    };
  },
});

const gridsRunNow = defineTool({
  name: "grids.run_now",
  description: "Trigger an immediate run of a custom grid agent (instead of waiting for its schedule).",
  grid: "grids",
  defaultAutonomy: "auto_apply",
  args: z.object({ customGridId: z.uuid() }),
  dryDescribe: (a) => `Run custom grid ${a.customGridId.slice(0, 8)} now`,
  async execute(_ctx, a) {
    const db = createAdminClient();
    const { data: row } = await db
      .from("custom_grids")
      .select("id, trip_id, agent_type, config, frequency_hours, consecutive_failures, autonomy")
      .eq("id", a.customGridId)
      .single();
    if (!row) throw new Error("Custom grid not found");
    const outcome = await runCustomGrid(row as unknown as CustomGridRow);
    return {
      summary: `Ran custom grid ${a.customGridId.slice(0, 8)} (${outcome.status})`,
      data: { outcome },
    };
  },
});

// ─── trip.* ──────────────────────────────────────────────────────────────────

const tripUpdate = defineTool({
  name: "trip.update",
  description: "Update top-level trip metadata (title, destination, dates).",
  grid: "trip",
  defaultAutonomy: "propose_only",
  args: z.object({
    title: z.string().min(1).max(120).optional(),
    destinationName: z.string().min(1).max(120).optional(),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }),
  dryDescribe: (a) => `Update trip: ${Object.keys(a).join(", ")}`,
  async execute(ctx, a) {
    const before = await snapshot("trips", ctx.tripId);
    const patch: Record<string, unknown> = {};
    if (a.title !== undefined) patch.title = a.title;
    if (a.destinationName !== undefined) patch.destination_name = a.destinationName;
    if (a.startDate !== undefined) patch.start_date = a.startDate;
    if (a.endDate !== undefined) patch.end_date = a.endDate;
    if (Object.keys(patch).length === 0) {
      return { summary: "No trip fields to update", data: {} };
    }
    const db = createAdminClient();
    const { error } = await db.from("trips").update(patch).eq("id", ctx.tripId);
    if (error) throw new Error(error.message);
    return {
      summary: `Updated trip (${Object.keys(patch).join(", ")})`,
      data: { patch },
      target: { table: "trips", id: ctx.tripId, op: "update", before },
    };
  },
});

// ─── registry ────────────────────────────────────────────────────────────────

const TOOLS: ToolDefinition[] = [
  itemsCreate,
  itemsUpdate,
  itemsMoveStage,
  itemsStartVote,
  itemsAddOption,
  itemsConfirm,
  itemsReopen,
  itemsDelete,
  ideasAdd,
  packAdd,
  expensesRecord,
  chatNotify,
  gridsAddAgent,
  gridsRunNow,
  tripUpdate,
];

const TOOL_MAP = new Map(TOOLS.map((t) => [t.name, t]));

export function listTools(): ToolDefinition[] {
  return TOOLS;
}

export function getTool(name: string): ToolDefinition | null {
  return TOOL_MAP.get(name) ?? null;
}

/** List the available custom-grid agents — used in the system prompt so the LLM
 *  knows what `grids.add_agent` can actually create. */
export function listCustomGridAgents(): Array<{ type: string; label: string; description: string }> {
  return listAgents().map((a) => ({ type: a.type, label: a.label, description: a.description }));
}

// ─── helpers ─────────────────────────────────────────────────────────────────

async function snapshot(table: string, id: string): Promise<Record<string, unknown> | null> {
  const db = createAdminClient();
  const { data } = await db.from(table).select("*").eq("id", id).maybeSingle();
  return (data as Record<string, unknown> | null) ?? null;
}

export type { ToolContext };

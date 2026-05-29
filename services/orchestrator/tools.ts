import { z } from "zod";
import { createAdminClient } from "@/lib/db";
import { pushText } from "@/lib/line";
import { appendTripLinkText, buildTripUrl } from "@/lib/trip-link";
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
import { searchPlaces, type PlaceCandidate } from "@/services/decisions/places";
import {
  defineTool,
  type ToolDefinition,
  type ToolContext,
  type TripPlan,
  type PlanCategory,
  type PlanTask,
  type PlanTaskOutcome,
} from "./types";

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
  description:
    "Add a voteable option to a decision item (e.g. a candidate hotel or restaurant). Always include `bookingUrl` (reservation/menu page) and `googleMapsUrl` when you have them — that's how members review and book. Pair with `places.search` to get real candidates with verified URLs and photos.",
  grid: "items",
  defaultAutonomy: "propose_only",
  args: z.object({
    itemId: z.uuid(),
    name: z.string().min(1).max(160),
    address: z.string().max(400).optional(),
    imageUrl: z.string().url().max(1000).optional(),
    bookingUrl: z.string().url().max(1000).optional(),
    googleMapsUrl: z.string().url().max(1000).optional(),
    rating: z.number().min(0).max(5).optional(),
    priceLevel: z.string().max(20).optional(),
    externalRef: z.string().max(200).optional(),
    lat: z.number().gte(-90).lte(90).optional(),
    lng: z.number().gte(-180).lte(180).optional(),
  }),
  dryDescribe: (a) =>
    a.bookingUrl
      ? `Add option "${a.name}" with booking link`
      : `Add option "${a.name}"`,
  async execute(_ctx, a) {
    const r = await addOption({ itemId: a.itemId, name: a.name });
    if (!r.ok) throw new Error(r.error);

    const patch: Record<string, unknown> = {};
    if (a.address) patch.address = a.address;
    if (a.imageUrl) patch.image_url = a.imageUrl;
    if (a.bookingUrl) patch.booking_url = a.bookingUrl;
    if (a.googleMapsUrl) patch.google_maps_url = a.googleMapsUrl;
    if (a.rating != null) patch.rating = a.rating;
    if (a.priceLevel) patch.price_level = a.priceLevel;
    if (a.externalRef) {
      patch.external_ref = a.externalRef;
      patch.provider = "google_places";
    }
    if (a.lat != null) patch.lat = a.lat;
    if (a.lng != null) patch.lng = a.lng;

    if (Object.keys(patch).length > 0) {
      const db = createAdminClient();
      const { error } = await db
        .from("trip_item_options")
        .update(patch)
        .eq("id", r.optionId);
      if (error) throw new Error(`Failed to attach place metadata: ${error.message}`);
    }

    return {
      summary: a.bookingUrl ? `Added "${a.name}" (with booking link)` : `Added option "${a.name}"`,
      data: { optionId: r.optionId, bookingUrl: a.bookingUrl ?? null },
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

const packAddMany = defineTool({
  name: "pack.add_many",
  description:
    "Bulk-add packing items. Use when seeding a starter list for a trip (typically 10–25 items spanning essentials, clothing, toiletries, electronics, documents tailored to the destination/season). Skip items that obviously duplicate existing pack rows the context already shows.",
  grid: "pack",
  defaultAutonomy: "auto_apply_with_undo",
  args: z.object({
    items: z
      .array(
        z.object({
          label: z.string().min(1).max(120),
          category: z.enum(PACK_CATEGORIES).optional(),
        }),
      )
      .min(1)
      .max(40),
  }),
  dryDescribe: (a) => `Add ${a.items.length} packing items`,
  async execute(ctx, a) {
    const db = createAdminClient();
    const rows = a.items.map((i) => ({
      trip_id: ctx.tripId,
      label: i.label,
      category: i.category ?? "general",
      added_by: `agent:${ctx.actorKey}`,
    }));
    const { data, error } = await db.from("packing_items").insert(rows).select("id, label");
    if (error || !data) throw new Error(error?.message ?? "failed to insert pack items");
    return {
      summary: `Added ${data.length} packing item(s)`,
      data: { ids: data.map((r) => r.id), labels: data.map((r) => r.label) },
      // Reversing a bulk insert needs caller-side cleanup, leave target unset.
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
    await pushText(
      target,
      appendTripLinkText(a.text, buildTripUrl(ctx.tripId)),
      (trip?.group_id as string) ?? undefined
    );
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

// ─── places.* ────────────────────────────────────────────────────────────────

const PLACE_KINDS = ["restaurant", "hotel", "activity", "transport"] as const satisfies readonly ItemType[];

const placesSearch = defineTool({
  name: "places.search",
  description:
    "Search Google Places for real candidates (restaurants, hotels, activities, transport). Returns a small list of named results with addresses, ratings, photo URLs, and Google Maps links — use these to populate options on a decision item via `items.add_option` so the user has real links to review and book. Read-only; safe to call freely.",
  grid: "items",
  defaultAutonomy: "auto_apply",
  args: z.object({
    query: z
      .string()
      .min(2)
      .max(200)
      .describe(
        "Free-text query, e.g. 'kid-friendly sushi in Shibuya' or 'boutique hotel near Kyoto station'. The trip's destination is appended automatically when `near` is omitted.",
      ),
    kind: z.enum(PLACE_KINDS).optional(),
    near: z
      .string()
      .max(200)
      .optional()
      .describe("Optional location override; defaults to the trip's destination_name."),
    maxResults: z.number().int().min(1).max(8).optional(),
  }),
  dryDescribe: (a) => `Search places: "${a.query}"${a.kind ? ` (${a.kind})` : ""}`,
  async execute(ctx, a) {
    const db = createAdminClient();
    const { data: trip } = await db
      .from("trips")
      .select("destination_name")
      .eq("id", ctx.tripId)
      .single();
    const near = a.near ?? (trip?.destination_name as string | null) ?? "";
    const combined = near ? `${a.query} in ${near}` : a.query;
    const kind: ItemType = a.kind ?? "activity";
    const max = a.maxResults ?? 5;
    const res = await searchPlaces(combined, kind, max);
    if (res.errorKind === "network_error") {
      throw new Error("Place search failed (network or API key missing)");
    }
    const candidates: PlaceCandidate[] = res.candidates;
    return {
      summary:
        candidates.length === 0
          ? `No places found for "${combined}"`
          : `Found ${candidates.length} place(s) for "${combined}"`,
      data: {
        query: combined,
        kind,
        candidates: candidates.map((c) => ({
          name: c.name,
          address: c.address,
          rating: c.rating,
          priceLevel: c.priceLevel,
          photoUrl: c.photoUrl,
          placeId: c.placeId,
          bookingUrl: c.bookingUrl,
        })),
      },
    };
  },
});

// ─── links.* (deterministic external URL builders) ──────────────────────────

const mapsDeepLink = defineTool({
  name: "maps.deep_link",
  description:
    "Build a Google Maps search URL for an arbitrary query (neighborhood, district, named landmark, generic service like 'airport transfer'). Use this when you don't have a specific Place candidate to attach but still want to give the user a clickable map link. Pair with `places.search` when you need names/photos/ratings; use this when the query is abstract.",
  grid: "trip",
  defaultAutonomy: "auto_apply",
  args: z.object({
    query: z.string().min(2).max(200),
  }),
  dryDescribe: (a) => `Maps link: "${a.query}"`,
  async execute(_ctx, a) {
    const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(a.query)}`;
    return {
      summary: `Maps link for "${a.query}"`,
      data: { url, query: a.query },
    };
  },
});

const flightsSearchLink = defineTool({
  name: "flights.search_link",
  description:
    "Build a Google Flights search URL for a route. We do not have a live flight pricing API in the orchestrator, so this is the best-value path: hand the user a pre-filled flight search they can sort by price/duration. If they want continuous tracking, suggest `grids.add_agent` with type='flight_price_tracker' afterwards.",
  grid: "trip",
  defaultAutonomy: "auto_apply",
  args: z.object({
    origin: z.string().min(2).max(64).describe("IATA code or city name, e.g. 'TPE' or 'Taipei'"),
    destination: z.string().min(2).max(64).describe("IATA code or city name, e.g. 'IAH' or 'Houston'"),
    departDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    returnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }),
  dryDescribe: (a) => `Flights link: ${a.origin} → ${a.destination}${a.departDate ? ` ${a.departDate}` : ""}`,
  async execute(_ctx, a) {
    const parts = [`flights from ${a.origin} to ${a.destination}`];
    if (a.departDate) parts.push(`on ${a.departDate}`);
    if (a.returnDate) parts.push(`returning ${a.returnDate}`);
    const q = parts.join(" ");
    const url = `https://www.google.com/travel/flights?q=${encodeURIComponent(q)}`;
    return {
      summary: `Flights link: ${a.origin} → ${a.destination}`,
      data: { url, query: q },
    };
  },
});

// ─── plan.* (Orchestrator-mode plan tree) ────────────────────────────────────

const PlanTaskSchema = z.object({
  id: z.string().min(1).max(80).optional(),
  title: z.string().min(1).max(200),
  done: z.boolean().optional(),
  note: z.string().max(500).optional(),
  tools: z
    .array(z.string().min(1).max(80))
    .min(1)
    .max(8)
    .describe(
      "Registry tool names the orchestrator may use to complete this task (e.g. ['places.search','items.create','items.add_option']). Pick only from the registered tools listed in the system prompt; unknowns are dropped.",
    ),
});

const PlanCategorySchema = z.object({
  id: z.string().min(1).max(80).optional(),
  title: z.string().min(1).max(80),
  summary: z.string().max(280).optional(),
  tasks: z.array(PlanTaskSchema).min(1).max(20),
});

const planUpsert = defineTool({
  name: "plan.upsert",
  description:
    "Replace the trip's structural plan shown in Orchestrator mode. The plan is a small set of categories (Stay, Transport, Activities, Food, Budget, Pack, Docs, etc.) — pick the ones essential for THIS trip — each with a few user-completable tasks. Keep it tight: 4–8 categories, 2–6 tasks each. Call this whenever the trip's structure has materially changed or no plan exists yet.",
  grid: "plan",
  // Plan is the orchestrator's reasoning artifact — apply directly.
  defaultAutonomy: "auto_apply",
  args: z.object({
    categories: z.array(PlanCategorySchema).min(1).max(12),
  }),
  dryDescribe: (a) =>
    `Update plan (${a.categories.length} categories, ${a.categories.reduce(
      (n, c) => n + c.tasks.length,
      0,
    )} tasks)`,
  async execute(ctx, a) {
    const db = createAdminClient();
    const { data: orch, error: readErr } = await db
      .from("trip_orchestrators")
      .select("memory, system_goal")
      .eq("id", ctx.orchestratorId)
      .single();
    if (readErr || !orch) throw new Error(readErr?.message ?? "orchestrator missing");

    const prevPlan = (orch.memory as { plan?: TripPlan } | null)?.plan ?? null;
    const prevTaskState = new Map<
      string,
      { done: boolean; outcome?: PlanTaskOutcome; tools?: string[] }
    >();
    if (prevPlan) {
      for (const c of prevPlan.categories) {
        for (const t of c.tasks) {
          prevTaskState.set(`${c.title}::${t.title}`, {
            done: t.done,
            outcome: t.outcome,
            tools: t.tools,
          });
        }
      }
    }

    const categories: PlanCategory[] = a.categories.map((c, ci) => ({
      id: c.id ?? `cat-${ci}-${slugify(c.title)}`,
      title: c.title,
      summary: c.summary,
      tasks: c.tasks.map((t, ti): PlanTask => {
        const inherited = prevTaskState.get(`${c.title}::${t.title}`);
        const bounded = sanitizeToolNames(t.tools);
        return {
          id: t.id ?? `task-${ci}-${ti}-${slugify(t.title)}`,
          title: t.title,
          done: t.done ?? inherited?.done ?? false,
          note: t.note,
          tools: bounded.length > 0 ? bounded : inherited?.tools,
          outcome: inherited?.outcome,
        };
      }),
    }));

    const plan: TripPlan = {
      generatedAt: new Date().toISOString(),
      categories,
    };

    const nextMemory = { ...(orch.memory ?? {}), plan };
    const { error: writeErr } = await db
      .from("trip_orchestrators")
      .update({ memory: nextMemory })
      .eq("id", ctx.orchestratorId);
    if (writeErr) throw new Error(writeErr.message);

    return {
      summary: `Plan updated (${categories.length} categories)`,
      data: { categories: categories.length, tasks: categories.reduce((n, c) => n + c.tasks.length, 0) },
    };
  },
});

const PlanTaskLinkSchema = z
  .object({
    kind: z.enum(["item", "idea", "packItem", "expense", "customGrid", "trip", "external"]),
    id: z.string().min(1).max(80).optional(),
    url: z.string().url().max(1000).optional(),
    label: z.string().max(120).optional(),
  })
  .refine((l) => (l.kind === "external" ? !!l.url : !!l.id), {
    message:
      "external links require `url`; internal links (item, idea, packItem, expense, customGrid, trip) require `id`",
  });

const planUpdateTask = defineTool({
  name: "plan.update_task",
  description:
    "Record progress on a plan task after you have taken concrete action on it. Set done=true once the task is complete; attach an outcome describing what you did and links to the entities you created (board items, ideas, pack items, expenses, custom grids). Use this after every batch of tool calls that advance a task — it's how the workspace shows progress to the user. Pass only the fields you want to change.",
  grid: "plan",
  defaultAutonomy: "auto_apply_with_undo",
  args: z.object({
    categoryId: z.string().min(1).max(80),
    taskId: z.string().min(1).max(80),
    done: z.boolean().optional(),
    note: z.string().max(500).optional(),
    outcome: z
      .object({
        summary: z.string().min(1).max(280),
        links: z.array(PlanTaskLinkSchema).max(20).optional(),
      })
      .optional(),
  }),
  dryDescribe: (a) =>
    a.outcome
      ? `Record outcome on ${a.taskId.slice(0, 16)}: "${a.outcome.summary.slice(0, 60)}"`
      : `Mark task ${a.taskId.slice(0, 16)} ${a.done ? "done" : "open"}`,
  async execute(ctx, a) {
    const db = createAdminClient();
    const { data: orch } = await db
      .from("trip_orchestrators")
      .select("memory")
      .eq("id", ctx.orchestratorId)
      .single();
    const plan = (orch?.memory as { plan?: TripPlan } | null)?.plan;
    if (!plan) throw new Error("No plan to update");
    let touched = false;
    const before = JSON.parse(JSON.stringify(plan)) as TripPlan;
    const next: TripPlan = {
      ...plan,
      categories: plan.categories.map((c) =>
        c.id !== a.categoryId
          ? c
          : {
              ...c,
              tasks: c.tasks.map((t) => {
                if (t.id !== a.taskId) return t;
                touched = true;
                const merged: PlanTask = { ...t };
                if (a.done !== undefined) merged.done = a.done;
                if (a.note !== undefined) merged.note = a.note;
                if (a.outcome) {
                  merged.outcome = {
                    summary: a.outcome.summary,
                    links: a.outcome.links ?? [],
                    completedAt: new Date().toISOString(),
                  };
                }
                return merged;
              }),
            },
      ),
    };
    if (!touched) throw new Error(`Task ${a.categoryId}/${a.taskId} not found`);
    const nextMemory = { ...(orch?.memory ?? {}), plan: next };
    const { error } = await db
      .from("trip_orchestrators")
      .update({ memory: nextMemory })
      .eq("id", ctx.orchestratorId);
    if (error) throw new Error(error.message);
    return {
      summary: a.outcome
        ? `Recorded outcome: ${a.outcome.summary.slice(0, 80)}`
        : `Task ${a.done ? "marked done" : "reopened"}`,
      data: { categoryId: a.categoryId, taskId: a.taskId, done: a.done, outcome: a.outcome },
      target: {
        table: "trip_orchestrators",
        id: ctx.orchestratorId,
        op: "update",
        before: { memory: { plan: before } },
      },
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
  packAddMany,
  expensesRecord,
  chatNotify,
  gridsAddAgent,
  gridsRunNow,
  tripUpdate,
  placesSearch,
  mapsDeepLink,
  flightsSearchLink,
  planUpsert,
  planUpdateTask,
];

const TOOL_MAP = new Map(TOOLS.map((t) => [t.name, t]));

export function listTools(): ToolDefinition[] {
  return TOOLS;
}

export function getTool(name: string): ToolDefinition | null {
  return TOOL_MAP.get(name) ?? null;
}

/** Just the registered tool names — used to surface the available surface
 *  area to the LLM when it generates per-task tool bindings. */
export function listToolNames(): string[] {
  return TOOLS.map((t) => t.name);
}

/** Filter an LLM-supplied tool list down to names that actually exist in the
 *  registry. Order-preserving and de-duplicated. Returns [] when nothing is
 *  recognized so callers can fall back to inherited bindings. */
export function sanitizeToolNames(input: string[] | undefined): string[] {
  if (!input || input.length === 0) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    const name = String(raw).trim();
    if (!name || seen.has(name)) continue;
    if (!TOOL_MAP.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
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

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export type { ToolContext };

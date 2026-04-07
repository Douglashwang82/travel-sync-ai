import { createAdminClient } from "@/lib/db";
import { createItem } from "@/services/trip-state";
import type { ParsedEntity, SuggestedAction } from "./extractor";
import type { ItemType } from "@/lib/types";

/**
 * Persist extracted entities to `parsed_entities` and apply suggested
 * actions — updating trip core fields or creating new board items.
 */
export async function applyParseResult(
  tripId: string,
  groupId: string,
  lineEventId: string,
  entities: ParsedEntity[],
  suggestedActions: SuggestedAction[],
  lineUserId?: string
): Promise<void> {
  if (entities.length === 0 && suggestedActions.length === 0) return;

  const db = createAdminClient();

  // ── 1. Persist all entities ───────────────────────────────────────────────
  if (entities.length > 0) {
    await db.from("parsed_entities").insert(
      entities.map((e) => ({
        group_id: groupId,
        trip_id: tripId,
        line_event_id: lineEventId,
        entity_type: e.type,
        canonical_value: e.canonicalValue,
        display_value: e.displayValue,
        confidence_score: e.confidence,
        // Inject the sender's line_user_id into availability entities so they can
        // be queried per-person later (e.g. for the daily digest).
        attributes_json:
          e.type === "availability" && lineUserId
            ? { ...(e.attributes ?? {}), line_user_id: lineUserId }
            : (e.attributes ?? {}),
      }))
    );
  }

  // ── 2. Apply suggested actions ────────────────────────────────────────────
  for (const action of suggestedActions) {
    switch (action.action) {
      case "update_trip_core":
        await applyTripCoreUpdate(tripId, action.field, entities);
        break;

      case "create_todo_item":
        if (action.itemTitle) {
          await createTodoIfAbsent(tripId, action.itemTitle, action.itemType, action.deadline);
        }
        break;

      case "add_option":
        if (action.optionName && action.itemType) {
          await addOptionToItem(tripId, action.optionName, action.itemType);
        }
        break;

      case "flag_conflict":
        // Conflicts are handled separately by conflict.ts — skip here
        break;
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function applyTripCoreUpdate(
  tripId: string,
  field: string | undefined,
  entities: ParsedEntity[]
): Promise<void> {
  if (!field) return;

  const db = createAdminClient();
  const patch: Record<string, unknown> = {};

  if (field === "destination") {
    const loc = entities.find((e) => e.type === "location");
    if (loc) patch.destination_name = loc.canonicalValue;
  } else if (field === "date_range" || field === "start_date" || field === "end_date") {
    const range = entities.find((e) => e.type === "date_range");
    if (range) {
      const [start, end] = range.canonicalValue.split("/");
      if (start) patch.start_date = start;
      if (end) patch.end_date = end;
    } else {
      const date = entities.find((e) => e.type === "date");
      if (date) {
        if (field === "start_date") patch.start_date = date.canonicalValue;
        if (field === "end_date") patch.end_date = date.canonicalValue;
      }
    }
  }

  if (Object.keys(patch).length > 0) {
    await db.from("trips").update(patch).eq("id", tripId);
  }
}

async function createTodoIfAbsent(
  tripId: string,
  title: string,
  itemType: string | undefined,
  deadline?: string
): Promise<void> {
  const db = createAdminClient();

  // Deduplicate: don't create an item with the same title in the same trip
  const { data: existing } = await db
    .from("trip_items")
    .select("id")
    .eq("trip_id", tripId)
    .ilike("title", title)
    .limit(1)
    .single();

  if (existing) return;

  await createItem({
    tripId,
    title,
    itemType: (itemType as ItemType) ?? "other",
    source: "ai",
    deadlineAt: deadline,
  });
}

/**
 * Add a named option to the latest non-confirmed trip item of the given type.
 * If no suitable item exists, creates one first.
 */
async function addOptionToItem(
  tripId: string,
  optionName: string,
  itemType: string
): Promise<void> {
  const db = createAdminClient();

  // Find the most recently created non-confirmed item of this type
  const { data: item } = await db
    .from("trip_items")
    .select("id")
    .eq("trip_id", tripId)
    .eq("item_type", itemType)
    .neq("stage", "confirmed")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  let itemId: string;

  if (item) {
    itemId = item.id;
  } else {
    // No suitable item exists — create one so the option has somewhere to live
    const result = await createItem({
      tripId,
      title: `Choose ${itemType}`,
      itemType: itemType as ItemType,
      source: "ai",
    });
    if (!result.ok) return;
    itemId = result.item.id;
  }

  // Dedup: skip if the same name already exists for this item (case-insensitive)
  const { data: existingOption } = await db
    .from("trip_item_options")
    .select("id")
    .eq("trip_item_id", itemId)
    .ilike("name", optionName)
    .limit(1)
    .single();

  if (existingOption) return;

  await db.from("trip_item_options").insert({
    trip_item_id: itemId,
    provider: "manual",
    name: optionName,
    external_ref: null,
    metadata_json: {},
  });
}

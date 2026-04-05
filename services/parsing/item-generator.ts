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
  suggestedActions: SuggestedAction[]
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
        attributes_json: e.attributes ?? {},
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
          await createTodoIfAbsent(tripId, action.itemTitle, action.itemType);
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
  itemType: string | undefined
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
  });
}

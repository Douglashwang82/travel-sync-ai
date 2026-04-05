import { createAdminClient } from "@/lib/db";
import { createItem } from "@/services/trip-state";
import type { Conflict } from "./extractor";

/**
 * For each LLM-detected conflict, create a Pending board item so the
 * organizer (or a /vote) can resolve it.
 */
export async function persistConflicts(
  tripId: string,
  groupId: string,
  lineEventId: string,
  conflicts: Conflict[]
): Promise<void> {
  if (conflicts.length === 0) return;

  const db = createAdminClient();

  for (const conflict of conflicts) {
    const title = `Conflict: ${conflict.field}`;
    const description =
      `${conflict.description}\n\n` +
      `Option A: ${conflict.existingValue}\n` +
      `Option B: ${conflict.newValue}`;

    // Check if an identical conflict item already exists to avoid duplicates
    const { data: existing } = await db
      .from("trip_items")
      .select("id")
      .eq("trip_id", tripId)
      .eq("title", title)
      .in("stage", ["todo", "pending"])
      .limit(1)
      .single();

    if (existing) continue;

    // Create as a pending item (needs organizer resolution or a vote)
    const result = await createItem({
      tripId,
      title,
      description,
      itemType: "other",
      source: "ai",
    });

    if (!result.ok) {
      console.error("[conflict] failed to create conflict item", conflict);
      continue;
    }

    // Move to pending immediately
    await db
      .from("trip_items")
      .update({ stage: "pending" })
      .eq("id", result.item.id);

    // Store as a conflict entity
    await db.from("parsed_entities").insert({
      group_id: groupId,
      trip_id: tripId,
      line_event_id: lineEventId,
      entity_type: "conflict",
      canonical_value: `${conflict.field}:${conflict.newValue}`,
      display_value: conflict.description,
      confidence_score: 1,
      attributes_json: {
        field: conflict.field,
        existing_value: conflict.existingValue,
        new_value: conflict.newValue,
      },
    });
  }
}

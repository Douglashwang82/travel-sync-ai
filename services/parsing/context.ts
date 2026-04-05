import { createAdminClient } from "@/lib/db";

export interface TripContext {
  tripId: string;
  destination: string | null;
  startDate: string | null;
  endDate: string | null;
  openItems: string[];          // titles of todo/pending items
  recentEntities: RecentEntity[];
}

interface RecentEntity {
  type: string;
  canonicalValue: string;
  displayValue: string;
}

const MAX_RECENT_ENTITIES = 20;
const MAX_OPEN_ITEMS = 10;

/**
 * Assembles a compact context object for the LLM prompt.
 * Uses structured data only — no raw message history.
 */
export async function assembleTripContext(
  groupId: string
): Promise<TripContext | null> {
  const db = createAdminClient();
  console.log(`[context] Querying for trip with group UUID: ${groupId}`);

  // Active trip
  const { data: trip, error } = await db
    .from("trips")
    .select("id, destination_name, start_date, end_date, status")
    .eq("group_id", groupId)
    .in("status", ["draft", "active"])
    .single();

  if (error) {
    console.warn(`[context] Trip query issue for group ${groupId}:`, error.message);
  }

  if (!trip) {
    console.warn(`[context] No active/draft trip found in DB for group ${groupId}.`);
    return null;
  }
  console.log(`[context] Found trip "${trip.destination_name}" (ID: ${trip.id}, Status: ${trip.status})`);

  // Recent parsed entities (last N, most recent first)
  const { data: entities } = await db
    .from("parsed_entities")
    .select("entity_type, canonical_value, display_value")
    .eq("group_id", groupId)
    .order("created_at", { ascending: false })
    .limit(MAX_RECENT_ENTITIES);

  // Open board items
  const { data: items } = await db
    .from("trip_items")
    .select("title")
    .eq("trip_id", trip.id)
    .in("stage", ["todo", "pending"])
    .order("created_at", { ascending: false })
    .limit(MAX_OPEN_ITEMS);

  return {
    tripId: trip.id,
    destination: trip.destination_name ?? null,
    startDate: trip.start_date ?? null,
    endDate: trip.end_date ?? null,
    openItems: (items ?? []).map((i) => i.title),
    recentEntities: (entities ?? []).map((e) => ({
      type: e.entity_type,
      canonicalValue: e.canonical_value,
      displayValue: e.display_value,
    })),
  };
}

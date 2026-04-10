import { createAdminClient } from "@/lib/db";
import { generateText } from "@/lib/gemini";
import { createItem } from "@/services/trip-state";
import type { ItemType, TripItem } from "@/lib/types";

/**
 * Fetch all knowledge-base items for a trip, optionally filtered by type.
 */
export async function getKnowledgeItems(
  tripId: string,
  itemType?: ItemType
): Promise<TripItem[]> {
  const db = createAdminClient();

  let query = db
    .from("trip_items")
    .select("*")
    .eq("trip_id", tripId)
    .eq("item_kind", "knowledge")
    .order("created_at", { ascending: true });

  if (itemType) {
    query = query.eq("item_type", itemType);
  }

  const { data } = await query;
  return (data ?? []) as TripItem[];
}

/**
 * Build a new decision item from knowledge-base items of the same type.
 *
 * Creates a 'decision' trip_item titled "Choose <type>" and imports each
 * knowledge item as a voteable trip_item_option. Returns the new decision
 * item id, or null if no knowledge items exist for that type.
 */
export async function buildDecisionFromKnowledge(
  tripId: string,
  itemType: ItemType,
  title?: string
): Promise<string | null> {
  const knowledge = await getKnowledgeItems(tripId, itemType);

  if (knowledge.length === 0) return null;

  const db = createAdminClient();
  const decisionTitle = title ?? `Choose ${itemType}`;

  const result = await createItem({
    tripId,
    title: decisionTitle,
    itemType,
    itemKind: "decision",
    source: "system",
  });

  if (!result.ok) return null;

  const decisionId = result.item.id;

  // Import each knowledge item as a voteable option
  const options = knowledge.map((k) => ({
    trip_item_id: decisionId,
    provider: "manual" as const,
    name: k.title,
    external_ref: null,
    metadata_json: {
      knowledge_item_id: k.id,
      source: k.source,
      description: k.description,
    },
  }));

  const { error } = await db.from("trip_item_options").insert(options);
  if (error) {
    console.error("[knowledge] failed to import knowledge items as options", error);
  }

  return decisionId;
}

/**
 * Generate an AI-suggested day-by-day trip plan using the knowledge base.
 *
 * Reads all knowledge items, confirmed decisions, and trip metadata, then
 * asks Gemini to draft an itinerary as a plain-text message suitable for
 * posting in a LINE group chat.
 */
export async function generateTripPlan(tripId: string): Promise<string> {
  const db = createAdminClient();

  const [{ data: trip }, { data: allItems }] = await Promise.all([
    db
      .from("trips")
      .select("title, destination_name, start_date, end_date")
      .eq("id", tripId)
      .single(),
    db
      .from("trip_items")
      .select("item_kind, item_type, title, description, stage, confirmed_option_id")
      .eq("trip_id", tripId)
      .order("created_at", { ascending: true }),
  ]);

  if (!trip) return "Could not load trip details to generate a plan.";

  const items = allItems ?? [];

  const knowledgeLines = items
    .filter((i) => i.item_kind === "knowledge")
    .map((i) => `- [${i.item_type}] ${i.title}${i.description ? `: ${i.description}` : ""}`)
    .join("\n");

  const confirmedLines = items
    .filter((i) => i.item_kind === "decision" && i.stage === "confirmed")
    .map((i) => `- [${i.item_type}] ${i.title}`)
    .join("\n");

  const systemPrompt = `You are a friendly travel planner assistant for a LINE group chat.
Your job is to suggest a practical day-by-day itinerary based on the trip details and saved places.
Write in a conversational tone, suitable for a chat message.
Use bullet points per day. Keep the total response under 600 characters.
If dates are unknown, suggest a generic N-day structure.
Reply in Traditional Chinese (zh-TW) unless the input is mostly English.`;

  const userMessage = `Trip: ${trip.title ?? trip.destination_name}
Destination: ${trip.destination_name}
Dates: ${trip.start_date && trip.end_date ? `${trip.start_date} to ${trip.end_date}` : "not set"}

Saved places (knowledge base):
${knowledgeLines || "(none yet)"}

Already confirmed:
${confirmedLines || "(none yet)"}

Please suggest a day-by-day itinerary that incorporates as many of the saved places as possible.`;

  try {
    return await generateText(systemPrompt, userMessage);
  } catch (err) {
    console.error("[knowledge] generateTripPlan Gemini call failed", err);
    return "Sorry, I couldn't generate a plan right now. Please try again later.";
  }
}

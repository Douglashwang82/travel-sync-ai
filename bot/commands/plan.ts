import { createAdminClient } from "@/lib/db";
import { pushText } from "@/lib/line";
import { generateTripPlan } from "@/services/knowledge";
import type { CommandContext } from "../router";

/**
 * /plan
 *
 * Asks the AI to suggest a day-by-day itinerary using the knowledge base
 * (saved places, shared links, AI-detected venues) plus any confirmed decisions.
 *
 * Example output posted to the group:
 *   Day 1: Arrive Osaka → Check in at [hotel]. Evening: [restaurant].
 *   Day 2: [activity]. Lunch: [restaurant]. ...
 */
export async function handlePlan(
  ctx: CommandContext,
  reply: (text: string) => Promise<void>
): Promise<void> {
  if (!ctx.dbGroupId || !ctx.lineGroupId) {
    await reply("Could not identify the group. Please try again.");
    return;
  }

  const db = createAdminClient();

  const { data: trip } = await db
    .from("trips")
    .select("id, destination_name")
    .eq("group_id", ctx.dbGroupId)
    .in("status", ["draft", "active"])
    .single();

  if (!trip) {
    await reply("No active trip. Use /start to create one first.");
    return;
  }

  await reply("Let me check your knowledge base and draft a plan... just a moment!");

  const plan = await generateTripPlan(trip.id);

  await pushText(ctx.lineGroupId, plan);
}

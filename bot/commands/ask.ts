import { createAdminClient } from "@/lib/db";
import { generateText, GeminiUnavailableError } from "@/lib/gemini";
import type { CommandContext } from "../router";
import type { ItemStage } from "@/lib/types";

interface BoardItem {
  title: string;
  item_type: string;
  stage: ItemStage;
  booking_status: string | null;
}

/**
 * /ask [question]
 * Answers a natural-language question about the active trip in the group chat.
 */
export async function handleAsk(
  args: string[],
  ctx: CommandContext,
  reply: (text: string) => Promise<void>
): Promise<void> {
  if (args.length === 0) {
    await reply("Usage: /ask [question]\nExample: /ask what hotels have we confirmed?");
    return;
  }

  if (!ctx.dbGroupId) {
    await reply("No active trip. Use /start to create one first.");
    return;
  }

  const question = args.join(" ");
  const db = createAdminClient();

  const { data: trip } = await db
    .from("trips")
    .select("id, destination_name, start_date, end_date, status")
    .eq("group_id", ctx.dbGroupId)
    .in("status", ["draft", "active"])
    .single();

  if (!trip) {
    await reply("No active trip. Use /start to create one first.");
    return;
  }

  const { data: items } = await db
    .from("trip_items")
    .select("title, item_type, stage, booking_status")
    .eq("trip_id", trip.id)
    .order("created_at", { ascending: true })
    .limit(50);

  const boardItems = (items ?? []) as BoardItem[];
  const todo = boardItems.filter((i) => i.stage === "todo").map((i) => i.title);
  const pending = boardItems.filter((i) => i.stage === "pending").map((i) => i.title);
  const confirmed = boardItems.filter((i) => i.stage === "confirmed").map((i) => i.title);

  const dateRange =
    trip.start_date && trip.end_date
      ? `${trip.start_date} to ${trip.end_date}`
      : "not set yet";

  const systemPrompt =
    `You are TravelBot, the AI assistant for this LINE travel group.\n` +
    `Answer the question using the trip data below. Be concise — keep your response under 5 lines.\n\n` +
    `Trip: ${trip.destination_name}\n` +
    `Dates: ${dateRange}\n` +
    `To-Do: ${todo.length > 0 ? todo.join(", ") : "none"}\n` +
    `Pending Vote: ${pending.length > 0 ? pending.join(", ") : "none"}\n` +
    `Confirmed: ${confirmed.length > 0 ? confirmed.join(", ") : "none"}\n\n` +
    `If the question is about something not in the data, say so clearly.`;

  try {
    const answer = (await generateText(systemPrompt, question)).trim();
    await reply(answer || "I'm not sure. Try rephrasing your question.");
  } catch (err) {
    if (err instanceof GeminiUnavailableError) {
      await reply("I'm temporarily unavailable. Please try again in a minute.");
      return;
    }
    console.error("[ask] generateText failed", err);
    await reply("Sorry, I couldn't answer that. Please try again.");
  }
}

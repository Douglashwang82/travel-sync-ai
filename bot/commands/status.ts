import { createAdminClient } from "@/lib/db";
import type { CommandContext } from "../router";

export async function handleStatus(
  ctx: CommandContext,
  reply: (text: string) => Promise<void>
): Promise<void> {
  if (!ctx.dbGroupId) {
    await reply("No active trip found. Use /start to create one.");
    return;
  }

  const db = createAdminClient();

  const { data: trip } = await db
    .from("trips")
    .select("id, destination_name, start_date, end_date")
    .eq("group_id", ctx.dbGroupId)
    .in("status", ["draft", "active"])
    .single();

  if (!trip) {
    await reply("No active trip found. Use /start [destination] [dates] to begin.");
    return;
  }

  const { data: items } = await db
    .from("trip_items")
    .select("title, stage")
    .eq("trip_id", trip.id)
    .order("created_at", { ascending: true });

  const todo = items?.filter((i) => i.stage === "todo") ?? [];
  const pending = items?.filter((i) => i.stage === "pending") ?? [];
  const confirmed = items?.filter((i) => i.stage === "confirmed") ?? [];

  const dateStr =
    trip.start_date && trip.end_date
      ? `${trip.start_date} → ${trip.end_date}`
      : "Dates TBD";

  const formatList = (list: { title: string }[], emoji: string) =>
    list.length === 0
      ? `  (empty)`
      : list.map((i) => `  ${emoji} ${i.title}`).join("\n");

  const message =
    `📋 Trip Board — ${trip.destination_name} (${dateStr})\n\n` +
    `📌 To-Do (${todo.length})\n${formatList(todo, "•")}\n\n` +
    `⏳ Pending (${pending.length})\n${formatList(pending, "⏳")}\n\n` +
    `✅ Confirmed (${confirmed.length})\n${formatList(confirmed, "✅")}`;

  await reply(message);
}

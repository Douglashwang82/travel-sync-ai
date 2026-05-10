import { createAdminClient } from "@/lib/db";
import type { CommandContext, Reply } from "../router";

type TripItem = {
  title: string;
  stage: string;
};

function formatDateRange(startDate: string | null, endDate: string | null): string {
  if (startDate && endDate) {
    return `${startDate} -> ${endDate}`;
  }

  return "Dates TBD";
}

function formatTextList(list: TripItem[], bullet: string): string {
  if (list.length === 0) {
    return "  (empty)";
  }

  return list.map((item) => `  ${bullet} ${item.title}`).join("\n");
}

export async function handleStatus(
  ctx: CommandContext,
  reply: Reply
): Promise<void> {
  if (!ctx.dbGroupId) {
    await reply("目前沒有進行中的旅程。請使用 /start 建立旅程。");
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
    await reply("目前沒有進行中的旅程。請使用 /start [目的地] [日期] 開始。");
    return;
  }

  const { data: items } = await db
    .from("trip_items")
    .select("title, stage")
    .eq("trip_id", trip.id)
    .order("created_at", { ascending: true });

  const todo = items?.filter((item) => item.stage === "todo") ?? [];
  const pending = items?.filter((item) => item.stage === "pending") ?? [];
  const confirmed = items?.filter((item) => item.stage === "confirmed") ?? [];

  const dateStr = formatDateRange(trip.start_date, trip.end_date);
  const summaryText =
    `Trip Board - ${trip.destination_name} (${dateStr})\n\n` +
    `To-Do (${todo.length})\n${formatTextList(todo, "•")}\n\n` +
    `Pending (${pending.length})\n${formatTextList(pending, "⏳")}\n\n` +
    `Confirmed (${confirmed.length})\n${formatTextList(confirmed, "✅")}`;

  await reply(summaryText);
}

import { createAdminClient } from "@/lib/db";
import { generateText, GeminiUnavailableError } from "@/lib/gemini";
import { BOT_COPY, BOT_LANGUAGE_RULE } from "@/lib/bot-copy";
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
    await reply("用法：/ask [問題]\n範例：/ask 我們確認了哪些飯店？");
    return;
  }

  if (!ctx.dbGroupId) {
    await reply(BOT_COPY.noActiveTrip);
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
    await reply(BOT_COPY.noActiveTrip);
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
      ? `${trip.start_date} 到 ${trip.end_date}`
      : "尚未設定";

  const systemPrompt =
    `You are TravelBot, the AI assistant for this LINE travel group.\n` +
    `${BOT_LANGUAGE_RULE}\n` +
    `請根據下方旅程資料回答問題，回覆精簡在 5 行以內。\n\n` +
    `旅程：${trip.destination_name ?? "尚未設定目的地"}\n` +
    `日期：${dateRange}\n` +
    `待辦：${todo.length > 0 ? todo.join(", ") : "無"}\n` +
    `投票中：${pending.length > 0 ? pending.join(", ") : "無"}\n` +
    `已確認：${confirmed.length > 0 ? confirmed.join(", ") : "無"}\n\n` +
    `如果問題詢問的內容不在資料中，請清楚說明目前看不到。`;

  try {
    const answer = (await generateText(systemPrompt, question)).trim();
    await reply(answer || "我還不確定答案。可以換個方式問我。");
  } catch (err) {
    if (err instanceof GeminiUnavailableError) {
      await reply(BOT_COPY.temporaryUnavailable);
      return;
    }
    console.error("[ask] generateText failed", err);
    await reply("抱歉，我剛剛無法回答這個問題，請再試一次。");
  }
}

import { createAdminClient } from "@/lib/db";
import { replyText } from "@/lib/line";
import { generateConversation, GeminiUnavailableError } from "@/lib/gemini";
import type { ConversationMessage } from "@/lib/gemini";
import { BOT_COPY, BOT_LANGUAGE_RULE } from "@/lib/bot-copy";
import { detectJapanSkiDestination } from "@/lib/ski-destination";

const MAX_HISTORY = 20;
const ONBOARDING_MESSAGE =
  "嗨，我是 TravelBot。若要和我聊你的旅程，請先把我加入你的 LINE 旅遊群組，再回到這裡。\n\n" +
  "只要你在有進行中旅程的群組裡，我就能回答問題、提供旅遊建議，並整理大家已經規劃好的內容。";

/**
 * Handle a LINE 1:1 DM from a user.
 * Finds the user's most recently active group, loads trip context,
 * retrieves conversation history, and replies with a trip-aware response.
 */
export async function handleDirectMessage(
  lineUserId: string,
  replyToken: string,
  messageText: string
): Promise<void> {
  const db = createAdminClient();

  // Find all groups this user is a member of (excluding 1:1 "group" rows the webhook creates,
  // which use the LINE userId — starting with 'U' — as line_group_id).
  const { data: memberships } = await db
    .from("group_members")
    .select("group_id, joined_at")
    .eq("line_user_id", lineUserId)
    .is("left_at", null)
    .order("joined_at", { ascending: false });

  if (!memberships || memberships.length === 0) {
    await replyText(replyToken, ONBOARDING_MESSAGE);
    return;
  }

  // Find the most recently joined active real group (line_group_id NOT starting with 'U')
  const { data: group } = await db
    .from("line_groups")
    .select("id, line_group_id, name, status")
    .in("id", memberships.map((m) => m.group_id))
    .eq("status", "active")
    .not("line_group_id", "like", "U%")
    .order("last_seen_at", { ascending: false })
    .limit(1)
    .single();

  if (!group) {
    await replyText(replyToken, ONBOARDING_MESSAGE);
    return;
  }

  const dbGroupId = group.id;

  // Get active trip for this group
  const { data: trip } = await db
    .from("trips")
    .select("id, destination_name, start_date, end_date, status")
    .eq("group_id", dbGroupId)
    .in("status", ["draft", "active"])
    .single();

  // Fetch conversation history
  const { data: historyRows } = await db
    .from("direct_chat_messages")
    .select("role, content")
    .eq("line_user_id", lineUserId)
    .eq("group_id", dbGroupId)
    .order("created_at", { ascending: false })
    .limit(MAX_HISTORY);

  const history: ConversationMessage[] = (historyRows ?? [])
    .reverse()
    .map((row) => ({ role: row.role as "user" | "agent", content: row.content }));

  const systemPrompt = buildSystemPrompt(group.name, trip);

  let agentReply: string;
  try {
    agentReply = (await generateConversation(systemPrompt, history, messageText)).trim();
    if (!agentReply) agentReply = "我還不確定怎麼回答。你可以換個方式問旅程規劃或活動安排。";
  } catch (err) {
    if (err instanceof GeminiUnavailableError) {
      agentReply = BOT_COPY.temporaryUnavailable;
    } else {
      console.error("[private-chat] generateConversation failed", err);
      agentReply = BOT_COPY.genericError;
    }
  }

  // Persist user message then agent reply
  await db.from("direct_chat_messages").insert([
    { line_user_id: lineUserId, group_id: dbGroupId, role: "user", content: messageText },
    { line_user_id: lineUserId, group_id: dbGroupId, role: "agent", content: agentReply },
  ]);

  await replyText(replyToken, agentReply);
}

function buildSystemPrompt(
  groupName: string | null,
  trip: { destination_name: string | null; start_date: string | null; end_date: string | null; status: string } | null
): string {
  const groupLabel = groupName ?? "your travel group";

  if (!trip) {
    return (
      `You are TravelBot, the AI assistant for ${groupLabel}.\n` +
      `${BOT_LANGUAGE_RULE}\n` +
      `這個群組目前沒有進行中的旅程。你可以請使用者提醒群組主揪在群組聊天室輸入 /start 開始規劃。\n` +
      `回覆要短、友善，適合 LINE 聊天。`
    );
  }

  const dateRange =
    trip.start_date && trip.end_date
      ? `${trip.start_date} 到 ${trip.end_date}`
      : "尚未設定日期";

  const skiMatch = detectJapanSkiDestination(trip.destination_name);
  const skiBlock = skiMatch.match
    ? `\n\n這是日本滑雪行程（${skiMatch.region.region}，${skiMatch.region.prefecture}）。` +
      `當被問到建議時，優先推薦：${skiMatch.region.region} 周邊的滑雪場、雪票/纜車券、` +
      `溫泉、ski-in/ski-out 飯店、上山午餐、après-ski 餐酒。提到雪況、最佳粉雪週、` +
      `初級/中級/高級雪道時，請以日本滑雪場的常識回答。`
    : "";

  return (
    `You are TravelBot, the AI assistant for ${groupLabel}.\n` +
    `${BOT_LANGUAGE_RULE}\n` +
    `你只能唯讀存取旅程規劃。你可以回答問題、提供旅遊建議、整理群組活動，但不能更改資料。\n\n` +
    `目前旅程：${trip.destination_name ?? "尚未設定目的地"}\n` +
    `日期：${dateRange}\n` +
    `狀態：${trip.status}\n\n` +
    `回覆保持精簡，適合 LINE 聊天。如果被問到資料中沒有的內容，請清楚說明目前看不到。${skiBlock}`
  );
}

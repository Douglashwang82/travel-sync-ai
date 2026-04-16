import { createAdminClient } from "@/lib/db";
import { replyText } from "@/lib/line";
import { generateConversation, GeminiUnavailableError } from "@/lib/gemini";
import type { ConversationMessage } from "@/lib/gemini";

const MAX_HISTORY = 20;
const ONBOARDING_MESSAGE =
  "Hi! I'm TravelBot. To chat with me about your trip, add me to your LINE travel group first, then come back here.\n\n" +
  "Once you're in a group with an active trip, I can answer questions, give travel advice, and summarize what your group has planned.";

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
    if (!agentReply) agentReply = "I'm not sure how to answer that. Try asking about your trip plans or activities.";
  } catch (err) {
    if (err instanceof GeminiUnavailableError) {
      agentReply = "I'm temporarily unavailable. Please try again in a minute.";
    } else {
      console.error("[private-chat] generateConversation failed", err);
      agentReply = "Sorry, something went wrong. Please try again.";
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
  trip: { destination_name: string; start_date: string | null; end_date: string | null; status: string } | null
): string {
  const groupLabel = groupName ?? "your travel group";

  if (!trip) {
    return (
      `You are TravelBot, the AI assistant for ${groupLabel}.\n` +
      `This group doesn't have an active trip yet. You can tell the user to ask the group organizer to type /start in the group chat to begin planning.\n` +
      `Keep replies short and friendly.`
    );
  }

  const dateRange =
    trip.start_date && trip.end_date
      ? `${trip.start_date} to ${trip.end_date}`
      : "dates not set yet";

  return (
    `You are TravelBot, the AI assistant for ${groupLabel}.\n` +
    `You have read-only access to the trip plan. You can answer questions, give travel advice, and summarize group activity — but you cannot make changes.\n\n` +
    `Active Trip: ${trip.destination_name}\n` +
    `Dates: ${dateRange}\n` +
    `Status: ${trip.status}\n\n` +
    `Keep replies concise — this is a LINE chat. If asked about something you don't have data on, say so clearly.`
  );
}

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/db";
import { requireAppTripAccess } from "@/lib/app-server";
import { getAgent } from "@/services/agents/registry";
import { wakeOrchestrator } from "@/services/orchestrator";
import {
  generateConversation,
  GeminiUnavailableError,
  type ConversationMessage,
} from "@/lib/gemini";

type RouteContext = {
  params: Promise<{ tripId: string; threadId: string }>;
};

export interface ChatMessage {
  id: string;
  threadId: string;
  senderKind: "user" | "agent";
  senderAppUserId: string | null;
  content: string;
  createdAt: string;
}

const SendSchema = z.object({
  content: z.string().trim().min(1).max(4000),
});

const MAX_HISTORY = 50;

function rowToMessage(row: Record<string, unknown>): ChatMessage {
  return {
    id: row.id as string,
    threadId: row.thread_id as string,
    senderKind: row.sender_kind as ChatMessage["senderKind"],
    senderAppUserId: (row.sender_app_user_id as string | null) ?? null,
    content: row.content as string,
    createdAt: row.created_at as string,
  };
}

/**
 * Authorize the caller for the thread: they must be a trip member AND a
 * participant (for member_dm) or any trip member (for agent threads).
 * Returns the thread row on success.
 */
async function authorizeThread(
  req: NextRequest,
  tripId: string,
  threadId: string,
): Promise<
  | { ok: true; thread: Record<string, unknown>; appUserId: string }
  | { ok: false; response: NextResponse }
> {
  const auth = await requireAppTripAccess(req, tripId);
  if (!auth.ok) return { ok: false, response: auth.response };

  const db = createAdminClient();
  const { data: thread } = await db
    .from("trip_chat_threads")
    .select("*")
    .eq("id", threadId)
    .eq("trip_id", tripId)
    .maybeSingle();
  if (!thread) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Thread not found", code: "NOT_FOUND" },
        { status: 404 },
      ),
    };
  }

  if (thread.kind === "member_dm") {
    if (
      thread.member_app_user_id_lo !== auth.appUserId &&
      thread.member_app_user_id_hi !== auth.appUserId
    ) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "Not a participant in this thread", code: "FORBIDDEN" },
          { status: 403 },
        ),
      };
    }
  }

  return { ok: true, thread, appUserId: auth.appUserId };
}

/** GET /api/app/trips/:tripId/chat/threads/:threadId/messages */
export async function GET(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const { tripId, threadId } = await ctx.params;
  const result = await authorizeThread(req, tripId, threadId);
  if (!result.ok) return result.response;

  const db = createAdminClient();
  const { data, error } = await db
    .from("trip_chat_messages")
    .select("*")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true });
  if (error) {
    return NextResponse.json(
      { error: "Failed to load messages", code: "DB_ERROR" },
      { status: 500 },
    );
  }

  // Surface per-participant last_read_at so the client can render read
  // receipts on the caller's outgoing messages.
  const { data: reads } = await db
    .from("trip_chat_thread_reads")
    .select("app_user_id, last_read_at")
    .eq("thread_id", threadId);

  const readsByAppUserId: Record<string, string> = {};
  for (const r of reads ?? []) {
    readsByAppUserId[r.app_user_id as string] = r.last_read_at as string;
  }

  return NextResponse.json({
    messages: (data ?? []).map(rowToMessage),
    reads: readsByAppUserId,
  });
}

/** POST /api/app/trips/:tripId/chat/threads/:threadId/messages */
export async function POST(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const { tripId, threadId } = await ctx.params;
  const result = await authorizeThread(req, tripId, threadId);
  if (!result.ok) return result.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON", code: "INVALID_JSON" }, { status: 400 });
  }

  const parsed = SendSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const db = createAdminClient();
  const { data: inserted, error: insertErr } = await db
    .from("trip_chat_messages")
    .insert({
      thread_id: threadId,
      sender_kind: "user",
      sender_app_user_id: result.appUserId,
      content: parsed.data.content,
    })
    .select("*")
    .single();

  if (insertErr || !inserted) {
    return NextResponse.json(
      { error: "Failed to send message", code: "DB_ERROR" },
      { status: 500 },
    );
  }

  // Bump the thread's updated_at so it can be sorted by recency client-side.
  await db
    .from("trip_chat_threads")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", threadId);

  const userMessage = rowToMessage(inserted);

  // For agent threads, synchronously generate a reply so the client gets both
  // turns in a single round-trip. If Gemini is unavailable, return only the
  // user message and let the client retry on next poll.
  let agentMessage: ChatMessage | null = null;
  if (result.thread.kind === "agent") {
    agentMessage = await tryAgentReply(
      threadId,
      result.thread,
      parsed.data.content,
      userMessage.id,
    );
  }

  // In the group room, a member's message wakes the per-trip orchestrator so
  // the AI planner reads the conversation and can propose a grid. wakeOrchestrator
  // returns fast (it schedules the actual run via Next.js `after()`).
  if (result.thread.kind === "group") {
    await wakeOrchestrator(tripId, "web group chat message");
  }

  return NextResponse.json({ message: userMessage, agentMessage }, { status: 201 });
}

async function tryAgentReply(
  threadId: string,
  thread: Record<string, unknown>,
  newContent: string,
  newMessageId: string,
): Promise<ChatMessage | null> {
  const db = createAdminClient();
  const customGridId = thread.agent_custom_grid_id as string | null;
  if (!customGridId) return null;

  const { data: grid } = await db
    .from("custom_grids")
    .select("agent_type, title, config, last_output, last_status, last_run_at")
    .eq("id", customGridId)
    .maybeSingle();
  if (!grid) return null;

  const agent = getAgent(grid.agent_type as string);
  if (!agent) return null;

  const { data: prior } = await db
    .from("trip_chat_messages")
    .select("*")
    .eq("thread_id", threadId)
    .neq("id", newMessageId)
    .order("created_at", { ascending: true })
    .limit(MAX_HISTORY);

  const history: ConversationMessage[] = (prior ?? []).map((m) => ({
    role: m.sender_kind === "agent" ? "agent" : "user",
    content: m.content as string,
  }));

  const systemPrompt = [
    `You are "${agent.label}", an AI agent embedded in a travel-planning workspace.`,
    `Your role: ${agent.description}`,
    `Mode: ${agent.mode}.`,
    `The user opened a chat with you from a custom bento tile titled "${grid.title as string}".`,
    grid.last_output
      ? `Your most recent run output (status: ${grid.last_status ?? "unknown"}, at ${grid.last_run_at ?? "n/a"}):\n${JSON.stringify(grid.last_output).slice(0, 2000)}`
      : "You have no run output yet for this tile.",
    "Reply in 1-3 short paragraphs. Plain text, no markdown headings. Stay in character as the named agent.",
  ].join("\n\n");

  let reply: string;
  try {
    reply = await generateConversation(systemPrompt, history, newContent);
  } catch (err) {
    if (err instanceof GeminiUnavailableError) {
      console.warn(`[trip-chat] Gemini unavailable for thread ${threadId}: ${err.message}`);
      return null;
    }
    console.error(`[trip-chat] agent reply failed for thread ${threadId}:`, err);
    return null;
  }

  const trimmed = reply.trim();
  if (!trimmed) return null;

  const { data: agentRow, error } = await db
    .from("trip_chat_messages")
    .insert({
      thread_id: threadId,
      sender_kind: "agent",
      sender_app_user_id: null,
      content: trimmed,
    })
    .select("*")
    .single();
  if (error || !agentRow) {
    console.error(`[trip-chat] failed to persist agent reply for ${threadId}:`, error);
    return null;
  }

  return rowToMessage(agentRow);
}

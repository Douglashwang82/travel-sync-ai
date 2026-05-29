import { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/db";
import { requireAppTripAccess } from "@/lib/app-server";

type RouteContext = {
  params: Promise<{ tripId: string; threadId: string }>;
};

export const dynamic = "force-dynamic";
// Keep the response streaming for up to 5 minutes; the client's EventSource
// will auto-reconnect if it closes. Vercel caps depending on plan; the route
// still works in dev and on hobby/pro plans within their limits.
export const maxDuration = 300;

/**
 * GET /api/app/trips/:tripId/chat/threads/:threadId/stream
 *
 * Server-Sent Events relay backed by Supabase Realtime. The browser opens an
 * EventSource on this URL; we authorize via the existing cookie session,
 * subscribe to `postgres_changes` for the thread's messages and reads, and
 * forward each row as a `message` SSE event. Closes the channel on client
 * disconnect.
 *
 * Event payloads:
 *   { type: "message", message: ChatMessage }
 *   { type: "read",    read: { appUserId, lastReadAt } }
 *   { type: "ping" }   — heartbeat every 25s to keep proxies from idling out
 */
export async function GET(req: NextRequest, ctx: RouteContext): Promise<Response> {
  const { tripId, threadId } = await ctx.params;
  const auth = await requireAppTripAccess(req, tripId);
  if (!auth.ok) return auth.response;

  const db = createAdminClient();
  const { data: thread } = await db
    .from("trip_chat_threads")
    .select("kind, member_app_user_id_lo, member_app_user_id_hi, trip_id")
    .eq("id", threadId)
    .eq("trip_id", tripId)
    .maybeSingle();
  if (!thread) {
    return new Response(
      JSON.stringify({ error: "Thread not found", code: "NOT_FOUND" }),
      { status: 404, headers: { "Content-Type": "application/json" } },
    );
  }
  if (
    thread.kind === "member_dm" &&
    thread.member_app_user_id_lo !== auth.appUserId &&
    thread.member_app_user_id_hi !== auth.appUserId
  ) {
    return new Response(
      JSON.stringify({ error: "Forbidden", code: "FORBIDDEN" }),
      { status: 403, headers: { "Content-Type": "application/json" } },
    );
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      function send(payload: unknown): void {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        } catch {
          closed = true;
        }
      }

      send({ type: "hello", threadId });

      const channel = db
        .channel(`trip-chat-${threadId}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "trip_chat_messages",
            filter: `thread_id=eq.${threadId}`,
          },
          (payload: { new: Record<string, unknown> }) => {
            const row = payload.new;
            send({
              type: "message",
              message: {
                id: row.id as string,
                threadId: row.thread_id as string,
                senderKind: row.sender_kind as "user" | "agent",
                senderAppUserId: (row.sender_app_user_id as string | null) ?? null,
                content: row.content as string,
                createdAt: row.created_at as string,
              },
            });
          },
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "trip_chat_thread_reads",
            filter: `thread_id=eq.${threadId}`,
          },
          (payload: { new: Record<string, unknown> | null }) => {
            const row = payload.new;
            if (!row) return;
            send({
              type: "read",
              read: {
                appUserId: row.app_user_id as string,
                lastReadAt: row.last_read_at as string,
              },
            });
          },
        )
        .subscribe();

      const heartbeat = setInterval(() => send({ type: "ping" }), 25_000);

      const cleanup = (): void => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        void db.removeChannel(channel);
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      req.signal.addEventListener("abort", cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

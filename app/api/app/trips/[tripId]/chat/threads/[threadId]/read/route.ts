import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/db";
import { requireAppTripAccessAllowGroupless } from "@/lib/app-server";

type RouteContext = {
  params: Promise<{ tripId: string; threadId: string }>;
};

/**
 * POST /api/app/trips/:tripId/chat/threads/:threadId/read
 *
 * Upserts a `trip_chat_thread_reads` row stamping the caller's last-read time
 * to "now". Idempotent. Used to clear unread badges when the chatroom is
 * opened (and after each send).
 */
export async function POST(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const { tripId, threadId } = await ctx.params;
  const auth = await requireAppTripAccessAllowGroupless(req, tripId);
  if (!auth.ok) return auth.response;

  const db = createAdminClient();
  const { data: thread } = await db
    .from("trip_chat_threads")
    .select("id, kind, member_app_user_id_lo, member_app_user_id_hi, trip_id")
    .eq("id", threadId)
    .eq("trip_id", tripId)
    .maybeSingle();
  if (!thread) {
    return NextResponse.json(
      { error: "Thread not found", code: "NOT_FOUND" },
      { status: 404 },
    );
  }

  if (
    thread.kind === "member_dm" &&
    thread.member_app_user_id_lo !== auth.appUserId &&
    thread.member_app_user_id_hi !== auth.appUserId
  ) {
    return NextResponse.json(
      { error: "Not a participant", code: "FORBIDDEN" },
      { status: 403 },
    );
  }

  const lastReadAt = new Date().toISOString();
  const { error } = await db
    .from("trip_chat_thread_reads")
    .upsert(
      {
        thread_id: threadId,
        app_user_id: auth.appUserId,
        last_read_at: lastReadAt,
      },
      { onConflict: "thread_id,app_user_id" },
    );

  if (error) {
    return NextResponse.json(
      { error: "Failed to update read state", code: "DB_ERROR" },
      { status: 500 },
    );
  }

  return NextResponse.json({ lastReadAt });
}

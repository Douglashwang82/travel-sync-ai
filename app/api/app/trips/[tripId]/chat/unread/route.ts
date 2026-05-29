import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/db";
import { requireAppTripAccess } from "@/lib/app-server";

type RouteContext = { params: Promise<{ tripId: string }> };

export interface UnreadOverview {
  total: number;
  byMemberAppUserId: Record<string, number>;
  byCustomGridId: Record<string, number>;
}

/**
 * GET /api/app/trips/:tripId/chat/unread
 *
 * Per-thread unread counts for the current user, keyed for easy lookup from
 * the navbar (members keyed by the OTHER participant's app_user_id; agents
 * keyed by custom_grid_id). A thread is "unread" if there exist messages
 * authored by someone else after the user's `last_read_at` (or no read row
 * exists at all).
 */
export async function GET(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const { tripId } = await ctx.params;
  const auth = await requireAppTripAccess(req, tripId);
  if (!auth.ok) return auth.response;

  const db = createAdminClient();

  // Threads where the caller is a participant: DMs they're in, or any agent
  // thread on this trip (agent threads are shared by all members).
  const { data: threads, error } = await db
    .from("trip_chat_threads")
    .select(
      "id, kind, member_app_user_id_lo, member_app_user_id_hi, agent_custom_grid_id",
    )
    .eq("trip_id", tripId)
    .or(
      `kind.eq.agent,member_app_user_id_lo.eq.${auth.appUserId},member_app_user_id_hi.eq.${auth.appUserId}`,
    );

  if (error) {
    return NextResponse.json(
      { error: "Failed to load threads", code: "DB_ERROR" },
      { status: 500 },
    );
  }

  const result: UnreadOverview = {
    total: 0,
    byMemberAppUserId: {},
    byCustomGridId: {},
  };
  if (!threads || threads.length === 0) {
    return NextResponse.json(result);
  }

  const threadIds = threads.map((t) => t.id as string);

  const { data: reads } = await db
    .from("trip_chat_thread_reads")
    .select("thread_id, last_read_at")
    .eq("app_user_id", auth.appUserId)
    .in("thread_id", threadIds);

  const lastReadByThread = new Map<string, string>();
  for (const r of reads ?? []) {
    lastReadByThread.set(r.thread_id as string, r.last_read_at as string);
  }

  // Pull every message in these threads not authored by the caller. Agent
  // messages have a NULL sender_app_user_id, so they're included via the OR
  // clause. We count per-thread in memory — fine while threads stay small;
  // swap to an aggregating RPC if that ever changes.
  const { data: msgs } = await db
    .from("trip_chat_messages")
    .select("thread_id, sender_app_user_id, created_at")
    .in("thread_id", threadIds)
    .or(`sender_app_user_id.is.null,sender_app_user_id.neq.${auth.appUserId}`);

  const countByThread = new Map<string, number>();
  for (const m of msgs ?? []) {
    const threadId = m.thread_id as string;
    const createdAt = m.created_at as string;
    const lastRead = lastReadByThread.get(threadId);
    if (lastRead && createdAt <= lastRead) continue;
    countByThread.set(threadId, (countByThread.get(threadId) ?? 0) + 1);
  }

  for (const t of threads) {
    const count = countByThread.get(t.id as string) ?? 0;
    if (count === 0) continue;
    result.total += count;
    if (t.kind === "member_dm") {
      const lo = t.member_app_user_id_lo as string | null;
      const hi = t.member_app_user_id_hi as string | null;
      const other = lo === auth.appUserId ? hi : lo;
      if (other) result.byMemberAppUserId[other] = count;
    } else if (t.kind === "agent") {
      const gridId = t.agent_custom_grid_id as string | null;
      if (gridId) result.byCustomGridId[gridId] = count;
    }
  }

  return NextResponse.json(result);
}

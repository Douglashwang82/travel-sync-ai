import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/db";
import { requireAppTripAccess } from "@/lib/app-server";

type RouteContext = { params: Promise<{ tripId: string }> };

export interface ChatThread {
  id: string;
  tripId: string;
  kind: "member_dm" | "agent";
  memberAppUserIdLo: string | null;
  memberAppUserIdHi: string | null;
  agentCustomGridId: string | null;
  createdAt: string;
}

const OpenSchema = z.union([
  z.object({
    kind: z.literal("member_dm"),
    targetAppUserId: z.string().uuid(),
  }),
  z.object({
    kind: z.literal("agent"),
    customGridId: z.string().uuid(),
  }),
]);

function rowToThread(row: Record<string, unknown>): ChatThread {
  return {
    id: row.id as string,
    tripId: row.trip_id as string,
    kind: row.kind as ChatThread["kind"],
    memberAppUserIdLo: (row.member_app_user_id_lo as string | null) ?? null,
    memberAppUserIdHi: (row.member_app_user_id_hi as string | null) ?? null,
    agentCustomGridId: (row.agent_custom_grid_id as string | null) ?? null,
    createdAt: row.created_at as string,
  };
}

/**
 * POST /api/app/trips/:tripId/chat/threads
 *
 * Idempotently opens (or returns) a chat thread for either:
 *   - a 1:1 DM with another trip member (kind: "member_dm")
 *   - the AI agent backing one of the trip's custom_grids (kind: "agent")
 */
export async function POST(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const { tripId } = await ctx.params;
  const auth = await requireAppTripAccess(req, tripId);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON", code: "INVALID_JSON" }, { status: 400 });
  }

  const parsed = OpenSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const db = createAdminClient();

  if (parsed.data.kind === "member_dm") {
    if (parsed.data.targetAppUserId === auth.appUserId) {
      return NextResponse.json(
        { error: "Cannot open a DM with yourself", code: "INVALID_TARGET" },
        { status: 400 },
      );
    }

    // Verify the target is a member of this trip (either via group or trip_members).
    const { data: target } = await db
      .from("app_users")
      .select("id, line_user_id")
      .eq("id", parsed.data.targetAppUserId)
      .maybeSingle();
    if (!target) {
      return NextResponse.json(
        { error: "Target user not found", code: "NOT_FOUND" },
        { status: 404 },
      );
    }

    const targetIsLineMember = auth.groupId
      ? Boolean(
          (
            await db
              .from("group_members")
              .select("role")
              .eq("group_id", auth.groupId)
              .eq("line_user_id", target.line_user_id as string)
              .is("left_at", null)
              .maybeSingle()
          ).data,
        )
      : false;
    const targetIsTripMember = Boolean(
      (
        await db
          .from("trip_members")
          .select("role")
          .eq("trip_id", tripId)
          .eq("app_user_id", parsed.data.targetAppUserId)
          .is("left_at", null)
          .maybeSingle()
      ).data,
    );
    if (!targetIsLineMember && !targetIsTripMember) {
      return NextResponse.json(
        { error: "Target is not a member of this trip", code: "FORBIDDEN" },
        { status: 403 },
      );
    }

    const [lo, hi] =
      auth.appUserId < parsed.data.targetAppUserId
        ? [auth.appUserId, parsed.data.targetAppUserId]
        : [parsed.data.targetAppUserId, auth.appUserId];

    const { data: existing } = await db
      .from("trip_chat_threads")
      .select("*")
      .eq("trip_id", tripId)
      .eq("kind", "member_dm")
      .eq("member_app_user_id_lo", lo)
      .eq("member_app_user_id_hi", hi)
      .maybeSingle();
    if (existing) return NextResponse.json({ thread: rowToThread(existing) });

    const { data: created, error } = await db
      .from("trip_chat_threads")
      .insert({
        trip_id: tripId,
        kind: "member_dm",
        member_app_user_id_lo: lo,
        member_app_user_id_hi: hi,
      })
      .select("*")
      .single();
    if (error || !created) {
      return NextResponse.json(
        { error: "Failed to open thread", code: "DB_ERROR" },
        { status: 500 },
      );
    }
    return NextResponse.json({ thread: rowToThread(created) }, { status: 201 });
  }

  // kind === "agent"
  const { data: grid } = await db
    .from("custom_grids")
    .select("id, trip_id, agent_type, title")
    .eq("id", parsed.data.customGridId)
    .maybeSingle();
  if (!grid || grid.trip_id !== tripId) {
    return NextResponse.json(
      { error: "Agent grid not found for this trip", code: "NOT_FOUND" },
      { status: 404 },
    );
  }

  const { data: existing } = await db
    .from("trip_chat_threads")
    .select("*")
    .eq("trip_id", tripId)
    .eq("kind", "agent")
    .eq("agent_custom_grid_id", parsed.data.customGridId)
    .maybeSingle();
  if (existing) return NextResponse.json({ thread: rowToThread(existing) });

  const { data: created, error } = await db
    .from("trip_chat_threads")
    .insert({
      trip_id: tripId,
      kind: "agent",
      agent_custom_grid_id: parsed.data.customGridId,
    })
    .select("*")
    .single();
  if (error || !created) {
    return NextResponse.json(
      { error: "Failed to open thread", code: "DB_ERROR" },
      { status: 500 },
    );
  }
  return NextResponse.json({ thread: rowToThread(created) }, { status: 201 });
}

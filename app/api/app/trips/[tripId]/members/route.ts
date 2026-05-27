import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/db";
import {
  requireAppTripAccess,
  requireAppUser,
} from "@/lib/app-server";
import { findAppUserByEmail } from "@/lib/app-users";

type RouteContext = { params: Promise<{ tripId: string }> };

export interface AppMember {
  lineUserId: string;
  appUserId: string | null;
  displayName: string | null;
  role: string;
  joinedAt: string;
  source: "line_group" | "trip_member";
  email: string | null;
}

/**
 * GET /api/app/trips/:tripId/members
 *
 * Returns the union of LINE group members (when the trip is bound to a group)
 * and direct trip-level members from `trip_members`. The `source` field lets
 * the UI distinguish between members who joined via the LINE group and those
 * added directly via the web app.
 */
export async function GET(
  req: NextRequest,
  ctx: RouteContext
): Promise<NextResponse> {
  const { tripId } = await ctx.params;
  const auth = await requireAppTripAccess(req, tripId);
  if (!auth.ok) return auth.response;

  const db = createAdminClient();
  const byLineUserId = new Map<string, AppMember>();

  if (auth.groupId) {
    const { data: lineMembers, error } = await db
      .from("group_members")
      .select("line_user_id, display_name, role, joined_at")
      .eq("group_id", auth.groupId)
      .is("left_at", null)
      .order("role", { ascending: true })
      .order("display_name", { ascending: true });

    if (error) {
      return NextResponse.json(
        { error: "Failed to load members", code: "DB_ERROR" },
        { status: 500 }
      );
    }

    const lineUserIds = (lineMembers ?? []).map((m) => m.line_user_id as string);
    const appUserByLineId = new Map<string, string>();
    if (lineUserIds.length) {
      const { data: appUsers } = await db
        .from("app_users")
        .select("id, line_user_id")
        .in("line_user_id", lineUserIds);
      for (const u of appUsers ?? []) {
        appUserByLineId.set(u.line_user_id as string, u.id as string);
      }
    }

    for (const m of lineMembers ?? []) {
      const lineUserId = m.line_user_id as string;
      byLineUserId.set(lineUserId, {
        lineUserId,
        appUserId: appUserByLineId.get(lineUserId) ?? null,
        displayName: (m.display_name as string | null) ?? null,
        role: m.role as string,
        joinedAt: m.joined_at as string,
        source: "line_group",
        email: null,
      });
    }
  }

  const { data: tripMembers, error: tmError } = await db
    .from("trip_members")
    .select(
      "role, joined_at, line_user_id, app_users!inner(id, email, display_name)"
    )
    .eq("trip_id", tripId)
    .is("left_at", null);

  if (tmError) {
    return NextResponse.json(
      { error: "Failed to load trip members", code: "DB_ERROR" },
      { status: 500 }
    );
  }

  for (const m of tripMembers ?? []) {
    const user = Array.isArray(m.app_users) ? m.app_users[0] : m.app_users;
    if (!user) continue;
    const lineUserId = m.line_user_id as string;
    if (byLineUserId.has(lineUserId)) continue;
    byLineUserId.set(lineUserId, {
      lineUserId,
      appUserId: (user.id as string | null) ?? null,
      displayName: (user.display_name as string | null) ?? null,
      role: m.role as string,
      joinedAt: m.joined_at as string,
      source: "trip_member",
      email: (user.email as string | null) ?? null,
    });
  }

  const result = Array.from(byLineUserId.values()).sort((a, b) => {
    if (a.role !== b.role) return a.role === "organizer" ? -1 : 1;
    return (a.displayName ?? "").localeCompare(b.displayName ?? "");
  });

  return NextResponse.json({ members: result });
}

const AddMemberSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  role: z.enum(["organizer", "member"]).optional(),
});

/**
 * POST /api/app/trips/:tripId/members
 *
 * Adds an existing registered user (by email) to a trip via `trip_members`.
 * Available to any current trip member — for now the simplest model — and
 * idempotent: re-adding a user that's already a member returns 200.
 */
export async function POST(
  req: NextRequest,
  ctx: RouteContext
): Promise<NextResponse> {
  const { tripId } = await ctx.params;

  const auth = await requireAppUser(req);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON", code: "INVALID_JSON" },
      { status: 400 }
    );
  }

  const parsed = AddMemberSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Validation failed",
        code: "VALIDATION_ERROR",
        details: parsed.error.flatten(),
      },
      { status: 400 }
    );
  }

  const db = createAdminClient();

  const { data: trip } = await db
    .from("trips")
    .select("id, group_id")
    .eq("id", tripId)
    .maybeSingle();
  if (!trip) {
    return NextResponse.json(
      { error: "Trip not found", code: "NOT_FOUND" },
      { status: 404 }
    );
  }

  // Caller must already be a member of the trip (via group_members or trip_members).
  const callerIsLineMember =
    trip.group_id !== null
      ? Boolean(
          (
            await db
              .from("group_members")
              .select("role")
              .eq("group_id", trip.group_id)
              .eq("line_user_id", auth.lineUserId)
              .is("left_at", null)
              .maybeSingle()
          ).data
        )
      : false;

  const callerIsTripMember = Boolean(
    (
      await db
        .from("trip_members")
        .select("role")
        .eq("trip_id", tripId)
        .eq("app_user_id", auth.appUserId)
        .is("left_at", null)
        .maybeSingle()
    ).data
  );

  if (!callerIsLineMember && !callerIsTripMember) {
    return NextResponse.json(
      { error: "You do not have access to this trip", code: "FORBIDDEN" },
      { status: 403 }
    );
  }

  const target = await findAppUserByEmail(parsed.data.email);
  if (!target) {
    return NextResponse.json(
      {
        error: "No registered user with that email. Ask them to sign up first.",
        code: "USER_NOT_FOUND",
      },
      { status: 404 }
    );
  }

  // Idempotent insert: if the user is already a member, return success.
  const { data: existing } = await db
    .from("trip_members")
    .select("id, left_at")
    .eq("trip_id", tripId)
    .eq("app_user_id", target.id)
    .maybeSingle();

  if (existing) {
    if (existing.left_at) {
      // Re-instate a former member.
      await db
        .from("trip_members")
        .update({ left_at: null, role: parsed.data.role ?? "member" })
        .eq("id", existing.id);
    }
    return NextResponse.json({ ok: true, alreadyMember: !existing.left_at });
  }

  const { error: insertErr } = await db.from("trip_members").insert({
    trip_id: tripId,
    app_user_id: target.id,
    line_user_id: target.line_user_id,
    role: parsed.data.role ?? "member",
  });

  if (insertErr) {
    return NextResponse.json(
      { error: "Failed to add member", code: "DB_ERROR" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    member: {
      lineUserId: target.line_user_id,
      email: target.email,
      displayName: target.display_name,
      role: parsed.data.role ?? "member",
    },
  });
}

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/db";
import { readAppSessionCookieFromRequest } from "@/lib/app-server";
import { originFromRequest } from "@/lib/app-line-login";

type RouteContext = { params: Promise<{ tripId: string }> };

function redirectTo(req: NextRequest, path: string): NextResponse {
  return NextResponse.redirect(`${originFromRequest(req)}${path}`, { status: 302 });
}

export async function GET(
  req: NextRequest,
  ctx: RouteContext
): Promise<NextResponse> {
  const { tripId } = await ctx.params;
  const next = `/app/join/${encodeURIComponent(tripId)}`;
  const lineUserId = await readAppSessionCookieFromRequest(req);

  if (!lineUserId) {
    return redirectTo(req, `/app/sign-in?next=${encodeURIComponent(next)}`);
  }

  const db = createAdminClient();
  const { data: user } = await db
    .from("app_users")
    .select("id, line_user_id")
    .eq("line_user_id", lineUserId)
    .maybeSingle();

  if (!user) {
    return redirectTo(req, `/app/sign-in?next=${encodeURIComponent(next)}`);
  }

  const { data: trip } = await db
    .from("trips")
    .select("id, group_id")
    .eq("id", tripId)
    .maybeSingle();

  if (!trip) {
    return new NextResponse("Trip not found", { status: 404 });
  }

  if (trip.group_id) {
    const { data: groupMember } = await db
      .from("group_members")
      .select("role")
      .eq("group_id", trip.group_id)
      .eq("line_user_id", lineUserId)
      .is("left_at", null)
      .maybeSingle();

    if (groupMember) {
      return redirectTo(req, `/app/trips/${encodeURIComponent(tripId)}`);
    }
  }

  const { data: existing } = await db
    .from("trip_members")
    .select("id, left_at")
    .eq("trip_id", tripId)
    .eq("app_user_id", user.id)
    .maybeSingle();

  if (existing) {
    if (existing.left_at) {
      const { error } = await db
        .from("trip_members")
        .update({ left_at: null, role: "member" })
        .eq("id", existing.id);

      if (error) {
        return new NextResponse("Failed to join trip", { status: 500 });
      }
    }
    return redirectTo(req, `/app/trips/${encodeURIComponent(tripId)}`);
  }

  const { error } = await db.from("trip_members").insert({
    trip_id: tripId,
    app_user_id: user.id,
    line_user_id: user.line_user_id,
    role: "member",
  });

  if (error) {
    return new NextResponse("Failed to join trip", { status: 500 });
  }

  return redirectTo(req, `/app/trips/${encodeURIComponent(tripId)}`);
}

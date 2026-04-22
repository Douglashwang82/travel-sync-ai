import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/db";

/**
 * Cookie-based session for the `/app` web experience.
 *
 * This is an interim mechanism while proper auth (e.g. LINE Login on web) is
 * built out. The cookie holds a `lineUserId` previously stored via the sign-in
 * picker; the server trusts it only because we are pre-auth. DO NOT ship this
 * to production without replacing with a verified identity provider.
 *
 * The cookie is readable both from route handlers (via the `cookies()` helper)
 * and from server components, and can be set from route handlers via the
 * `NextResponse.cookies` API.
 */

export const APP_SESSION_COOKIE = "ts_app_user";
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export function setAppSessionCookie(res: NextResponse, lineUserId: string): void {
  res.cookies.set({
    name: APP_SESSION_COOKIE,
    value: lineUserId,
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: ONE_YEAR_SECONDS,
  });
}

export function clearAppSessionCookie(res: NextResponse): void {
  res.cookies.set({
    name: APP_SESSION_COOKIE,
    value: "",
    path: "/",
    maxAge: 0,
  });
}

export async function readAppSessionCookieFromRequest(
  req: NextRequest
): Promise<string | null> {
  return req.cookies.get(APP_SESSION_COOKIE)?.value ?? null;
}

export async function readAppSessionCookie(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(APP_SESSION_COOKIE)?.value ?? null;
}

// ─── Auth guards for /api/app route handlers ───────────────────────────────────

type Json = Record<string, unknown>;

function unauthorized(): NextResponse {
  return NextResponse.json<Json>(
    { error: "Not signed in", code: "UNAUTHORIZED" },
    { status: 401 }
  );
}

function forbidden(): NextResponse {
  return NextResponse.json<Json>(
    { error: "You do not have access to this trip", code: "FORBIDDEN" },
    { status: 403 }
  );
}

function notFound(entity: string): NextResponse {
  return NextResponse.json<Json>(
    { error: `${entity} not found`, code: "NOT_FOUND" },
    { status: 404 }
  );
}

export type AppAuthResult =
  | { ok: true; lineUserId: string }
  | { ok: false; response: NextResponse };

export async function requireAppUser(req: NextRequest): Promise<AppAuthResult> {
  const lineUserId = await readAppSessionCookieFromRequest(req);
  if (!lineUserId) return { ok: false, response: unauthorized() };
  return { ok: true, lineUserId };
}

export type AppTripAuthResult =
  | {
      ok: true;
      lineUserId: string;
      groupId: string;
      role: "organizer" | "member";
    }
  | { ok: false; response: NextResponse };

export async function requireAppTripAccess(
  req: NextRequest,
  tripId: string
): Promise<AppTripAuthResult> {
  const auth = await requireAppUser(req);
  if (!auth.ok) return auth;

  const db = createAdminClient();
  const { data: trip } = await db
    .from("trips")
    .select("group_id")
    .eq("id", tripId)
    .single();

  if (!trip) return { ok: false, response: notFound("Trip") };

  const { data: membership } = await db
    .from("group_members")
    .select("group_id, role")
    .eq("group_id", trip.group_id)
    .eq("line_user_id", auth.lineUserId)
    .is("left_at", null)
    .single();

  if (!membership) return { ok: false, response: forbidden() };

  return {
    ok: true,
    lineUserId: auth.lineUserId,
    groupId: trip.group_id,
    role: (membership.role as "organizer" | "member") ?? "member",
  };
}

export async function requireAppOrganizer(
  req: NextRequest,
  tripId: string
): Promise<AppTripAuthResult> {
  const auth = await requireAppTripAccess(req, tripId);
  if (!auth.ok) return auth;
  if (auth.role !== "organizer") {
    return {
      ok: false,
      response: NextResponse.json<Json>(
        { error: "Organizer access required", code: "FORBIDDEN" },
        { status: 403 }
      ),
    };
  }
  return auth;
}

export async function requireAppOrganizerForItem(
  req: NextRequest,
  itemId: string
): Promise<AppTripAuthResult> {
  const db = createAdminClient();
  const { data: item } = await db
    .from("trip_items")
    .select("trip_id")
    .eq("id", itemId)
    .single();
  if (!item) return { ok: false, response: notFound("Item") };
  return requireAppOrganizer(req, item.trip_id);
}

export async function requireAppTripAccessForItem(
  req: NextRequest,
  itemId: string
): Promise<AppTripAuthResult> {
  const db = createAdminClient();
  const { data: item } = await db
    .from("trip_items")
    .select("trip_id")
    .eq("id", itemId)
    .single();
  if (!item) return { ok: false, response: notFound("Item") };
  return requireAppTripAccess(req, item.trip_id);
}

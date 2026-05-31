import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/db";
import { lineUserIdFromAuthHeader } from "@/lib/app-tokens";

/**
 * Session resolution for the `/app` experience, web and mobile.
 *
 * Identity is a `line_user_id`. For users who signed in via LINE Login this is
 * their real LINE id; for users who registered with email/password we generate
 * a synthetic id (`app_<uuid>`) so all downstream tables that key on
 * `line_user_id` keep working without branching. It is resolved to an
 * `app_users` row via `requireAppUser`.
 *
 * Two transports carry the identity, checked in this order:
 *   1. `Authorization: Bearer <jwt>` — native mobile apps (see `lib/app-tokens.ts`).
 *      Native clients can't use the browser cookie jar, so they send a signed
 *      access token instead.
 *   2. The HttpOnly `ts_app_user` cookie — the web `/app` client.
 *
 * Both resolve to the same `line_user_id`, so every guard below is transport
 * agnostic: adding bearer support here unlocks the entire `/api/app` surface
 * for mobile without touching individual route handlers.
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

/**
 * Resolve the caller's `line_user_id` from either transport: a bearer access
 * token (mobile) takes precedence, falling back to the session cookie (web).
 * Returns `null` when neither is present or valid.
 */
export async function resolveSessionLineUserId(
  req: NextRequest
): Promise<string | null> {
  const fromBearer = lineUserIdFromAuthHeader(req.headers.get("authorization"));
  if (fromBearer) return fromBearer;
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
  | {
      ok: true;
      lineUserId: string;
      appUserId: string;
      email: string | null;
      displayName: string | null;
    }
  | { ok: false; response: NextResponse };

export async function requireAppUser(req: NextRequest): Promise<AppAuthResult> {
  const lineUserId = await resolveSessionLineUserId(req);
  if (!lineUserId) return { ok: false, response: unauthorized() };

  const db = createAdminClient();
  const { data: user } = await db
    .from("app_users")
    .select("id, email, display_name, line_user_id")
    .eq("line_user_id", lineUserId)
    .maybeSingle();

  if (!user) return { ok: false, response: unauthorized() };

  return {
    ok: true,
    lineUserId: user.line_user_id as string,
    appUserId: user.id as string,
    email: (user.email as string | null) ?? null,
    displayName: (user.display_name as string | null) ?? null,
  };
}

export type AppTripAuthResult =
  | {
      ok: true;
      lineUserId: string;
      appUserId: string;
      groupId: string | null;
      role: "organizer" | "member";
    }
  | { ok: false; response: NextResponse };

export type AppTripAuthResultWithGroup =
  | {
      ok: true;
      lineUserId: string;
      appUserId: string;
      groupId: string;
      role: "organizer" | "member";
    }
  | { ok: false; response: NextResponse };

/**
 * Authorize a user for a specific trip.
 *
 * Access is granted if the user belongs to the trip's LINE group via
 * `group_members`, or if they were added directly via `trip_members`.
 * `groupId` is `null` for personal (group-less) trips created via the
 * itinerary wizard — endpoints that need to push to LINE or write to
 * group-scoped tables should use `requireAppTripWithGroup` instead.
 */
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

  const groupId = (trip.group_id as string | null) ?? null;

  if (groupId) {
    const { data: gm } = await db
      .from("group_members")
      .select("role")
      .eq("group_id", groupId)
      .eq("line_user_id", auth.lineUserId)
      .is("left_at", null)
      .maybeSingle();

    if (gm) {
      return {
        ok: true,
        lineUserId: auth.lineUserId,
        appUserId: auth.appUserId,
        groupId,
        role: ((gm.role as string) === "organizer" ? "organizer" : "member"),
      };
    }
  }

  const { data: tm } = await db
    .from("trip_members")
    .select("role")
    .eq("trip_id", tripId)
    .eq("app_user_id", auth.appUserId)
    .is("left_at", null)
    .maybeSingle();

  if (tm) {
    return {
      ok: true,
      lineUserId: auth.lineUserId,
      appUserId: auth.appUserId,
      groupId,
      role: ((tm.role as string) === "organizer" ? "organizer" : "member"),
    };
  }

  return { ok: false, response: forbidden() };
}

/**
 * Like `requireAppTripAccess` but rejects trips with no LINE group.
 * Use for endpoints that push to LINE or write to group-scoped tables
 * (votes, expenses, day-notes, plan-master, …).
 */
export async function requireAppTripWithGroup(
  req: NextRequest,
  tripId: string
): Promise<AppTripAuthResultWithGroup> {
  const auth = await requireAppTripAccess(req, tripId);
  if (!auth.ok) return auth;
  if (!auth.groupId) {
    return {
      ok: false,
      response: NextResponse.json<Json>(
        {
          error:
            "This trip is not linked to a LINE group, so this feature is unavailable.",
          code: "GROUP_REQUIRED",
        },
        { status: 400 }
      ),
    };
  }
  return {
    ok: true,
    lineUserId: auth.lineUserId,
    appUserId: auth.appUserId,
    groupId: auth.groupId,
    role: auth.role,
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

export async function requireAppOrganizerWithGroup(
  req: NextRequest,
  tripId: string
): Promise<AppTripAuthResultWithGroup> {
  const auth = await requireAppTripWithGroup(req, tripId);
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

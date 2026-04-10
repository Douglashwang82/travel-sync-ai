import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/db";
import { extractBearerToken, verifyLiffToken } from "@/lib/liff-auth";

export interface LiffAuthResult {
  ok: true;
  lineUserId: string;
}

export interface LiffAuthError {
  ok: false;
  response: NextResponse;
}

export type LiffMembershipResult =
  | {
      ok: true;
      lineUserId: string;
      membership: {
        groupId: string;
        role: string;
      };
    }
  | LiffAuthError;

export async function authenticateLiffRequest(
  req: NextRequest
): Promise<LiffAuthResult | LiffAuthError> {
  const idToken = extractBearerToken(req.headers.get("Authorization"));
  if (!idToken) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Missing Authorization header", code: "UNAUTHORIZED" },
        { status: 401 }
      ),
    };
  }

  const lineUserId = await verifyLiffToken(idToken);
  if (!lineUserId) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Invalid or expired LIFF token", code: "UNAUTHORIZED" },
        { status: 401 }
      ),
    };
  }

  return { ok: true, lineUserId };
}

export async function requireGroupMembership(
  req: NextRequest,
  groupId: string
): Promise<LiffMembershipResult> {
  const auth = await authenticateLiffRequest(req);
  if (!auth.ok) return auth;

  const db = createAdminClient();
  const { data: membership } = await db
    .from("group_members")
    .select("group_id, role")
    .eq("group_id", groupId)
    .eq("line_user_id", auth.lineUserId)
    .is("left_at", null)
    .single();

  if (!membership) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "You do not have access to this group", code: "FORBIDDEN" },
        { status: 403 }
      ),
    };
  }

  return {
    ok: true,
    lineUserId: auth.lineUserId,
    membership: {
      groupId: membership.group_id,
      role: membership.role,
    },
  };
}

export async function requireTripMembership(
  req: NextRequest,
  tripId: string
): Promise<LiffMembershipResult> {
  const db = createAdminClient();
  const { data: trip } = await db.from("trips").select("group_id").eq("id", tripId).single();

  if (!trip) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Trip not found", code: "NOT_FOUND" },
        { status: 404 }
      ),
    };
  }

  return requireGroupMembership(req, trip.group_id);
}

export async function requireOrganizerForTrip(
  req: NextRequest,
  tripId: string
): Promise<LiffMembershipResult> {
  const membership = await requireTripMembership(req, tripId);
  if (!membership.ok) return membership;

  if (membership.membership.role !== "organizer") {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Organizer access required", code: "FORBIDDEN" },
        { status: 403 }
      ),
    };
  }

  return membership;
}

export async function requireOrganizerForItem(
  req: NextRequest,
  itemId: string
): Promise<LiffMembershipResult> {
  const db = createAdminClient();
  const { data: item } = await db.from("trip_items").select("trip_id").eq("id", itemId).single();

  if (!item) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Item not found", code: "NOT_FOUND" },
        { status: 404 }
      ),
    };
  }

  return requireOrganizerForTrip(req, item.trip_id);
}

export async function requireVoteAccess(
  req: NextRequest,
  tripItemId: string
): Promise<
  | {
      ok: true;
      lineUserId: string;
      groupId: string;
      lineGroupId: string;
    }
  | LiffAuthError
> {
  const auth = await authenticateLiffRequest(req);
  if (!auth.ok) return auth;

  const db = createAdminClient();
  const { data: item } = await db.from("trip_items").select("trip_id").eq("id", tripItemId).single();
  if (!item) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Item not found", code: "NOT_FOUND" },
        { status: 404 }
      ),
    };
  }

  const { data: trip } = await db.from("trips").select("group_id").eq("id", item.trip_id).single();
  if (!trip) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Trip not found", code: "NOT_FOUND" },
        { status: 404 }
      ),
    };
  }

  const { data: membership } = await db
    .from("group_members")
    .select("group_id")
    .eq("group_id", trip.group_id)
    .eq("line_user_id", auth.lineUserId)
    .is("left_at", null)
    .single();

  if (!membership) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "You do not have access to this vote", code: "FORBIDDEN" },
        { status: 403 }
      ),
    };
  }

  const { data: group } = await db
    .from("line_groups")
    .select("line_group_id")
    .eq("id", trip.group_id)
    .single();

  if (!group?.line_group_id) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Group not found", code: "NOT_FOUND" },
        { status: 404 }
      ),
    };
  }

  return {
    ok: true,
    lineUserId: auth.lineUserId,
    groupId: trip.group_id,
    lineGroupId: group.line_group_id,
  };
}

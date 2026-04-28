import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/db";
import { authenticateLiffRequest } from "@/lib/liff-server";
import type { ApiError } from "@/lib/types";

export interface LiffTripSummary {
  id: string;
  groupId: string;
  groupName: string | null;
  destinationName: string | null;
  startDate: string | null;
  endDate: string | null;
  status: string;
  itemCount: number;
  createdAt: string;
}

export interface LiffTripsResponse {
  trips: LiffTripSummary[];
}

/**
 * GET /api/liff/trips
 *
 * Returns every trip across the authed user's real, active LINE groups.
 * Used by the LIFF dashboard list view (active vs past). Excludes the fake
 * "U…" 1:1 chat groups the webhook upserts for DM events and any group
 * marked removed/archived.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await authenticateLiffRequest(req);
  if (!auth.ok) return auth.response;

  const db = createAdminClient();

  const { data: memberships, error: memberError } = await db
    .from("group_members")
    .select("group_id")
    .eq("line_user_id", auth.lineUserId)
    .is("left_at", null);

  if (memberError) {
    return NextResponse.json<ApiError>(
      { error: "Failed to load memberships", code: "DB_ERROR" },
      { status: 500 }
    );
  }

  const groupIds = (memberships ?? []).map((m) => m.group_id as string);
  if (groupIds.length === 0) {
    return NextResponse.json<LiffTripsResponse>({ trips: [] });
  }

  const { data: groups, error: groupsError } = await db
    .from("line_groups")
    .select("id, name, status, line_group_id")
    .in("id", groupIds)
    .eq("status", "active")
    .not("line_group_id", "like", "U%");

  if (groupsError) {
    return NextResponse.json<ApiError>(
      { error: "Failed to load groups", code: "DB_ERROR" },
      { status: 500 }
    );
  }

  const realGroups = groups ?? [];
  if (realGroups.length === 0) {
    return NextResponse.json<LiffTripsResponse>({ trips: [] });
  }

  const realGroupIds = realGroups.map((g) => g.id as string);
  const groupNameById = new Map(
    realGroups.map((g) => [g.id as string, (g.name as string | null) ?? null])
  );

  const { data: tripRows, error: tripsError } = await db
    .from("trips")
    .select("id, group_id, destination_name, start_date, end_date, status, created_at")
    .in("group_id", realGroupIds)
    .order("created_at", { ascending: false });

  if (tripsError) {
    return NextResponse.json<ApiError>(
      { error: "Failed to load trips", code: "DB_ERROR" },
      { status: 500 }
    );
  }

  const tripIds = (tripRows ?? []).map((t) => t.id as string);
  const itemCounts = new Map<string, number>();
  if (tripIds.length > 0) {
    const { data: itemRows } = await db
      .from("trip_items")
      .select("trip_id")
      .in("trip_id", tripIds);
    for (const item of itemRows ?? []) {
      const key = item.trip_id as string;
      itemCounts.set(key, (itemCounts.get(key) ?? 0) + 1);
    }
  }

  const trips: LiffTripSummary[] = (tripRows ?? []).map((t) => ({
    id: t.id as string,
    groupId: t.group_id as string,
    groupName: groupNameById.get(t.group_id as string) ?? null,
    destinationName: (t.destination_name as string | null) ?? null,
    startDate: (t.start_date as string | null) ?? null,
    endDate: (t.end_date as string | null) ?? null,
    status: t.status as string,
    itemCount: itemCounts.get(t.id as string) ?? 0,
    createdAt: t.created_at as string,
  }));

  return NextResponse.json<LiffTripsResponse>({ trips });
}

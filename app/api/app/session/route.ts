import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/db";
import { requireAppUser } from "@/lib/app-server";

export interface AppSessionGroup {
  id: string;
  lineGroupId: string;
  name: string | null;
  role: "organizer" | "member";
}

export interface AppSessionTripSummary {
  id: string;
  groupId: string | null;
  destinationName: string | null;
  startDate: string | null;
  endDate: string | null;
  status: string;
  itemCount: number;
}

export interface AppSessionResponse {
  lineUserId: string;
  appUserId: string;
  email: string | null;
  displayName: string | null;
  groups: AppSessionGroup[];
  trips: AppSessionTripSummary[];
}

/**
 * GET /api/app/session — returns the signed-in user's groups and trip summaries.
 * Used by the web app to render the trip list and top-level navigation.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAppUser(req);
  if (!auth.ok) return auth.response;

  const db = createAdminClient();

  const { data: memberships, error: memberError } = await db
    .from("group_members")
    .select(
      "display_name, role, group_id, line_groups!inner(id, line_group_id, name, status, last_seen_at)"
    )
    .eq("line_user_id", auth.lineUserId)
    .is("left_at", null);

  if (memberError) {
    return NextResponse.json(
      { error: "Failed to load memberships", code: "DB_ERROR" },
      { status: 500 }
    );
  }

  const groups: AppSessionGroup[] = [];
  const groupIds: string[] = [];
  let displayName: string | null = auth.displayName;

  for (const row of memberships ?? []) {
    const group = Array.isArray(row.line_groups) ? row.line_groups[0] : row.line_groups;
    if (!group || (group.status as string) === "removed") continue;
    groups.push({
      id: group.id as string,
      lineGroupId: group.line_group_id as string,
      name: (group.name as string | null) ?? null,
      role: ((row.role as string) === "organizer" ? "organizer" : "member") as
        | "organizer"
        | "member",
    });
    groupIds.push(group.id as string);
    if (!displayName && row.display_name) displayName = row.display_name as string;
  }

  // Trips reachable via LINE group_members.
  const tripsById = new Map<string, AppSessionTripSummary>();

  if (groupIds.length > 0) {
    const { data: tripRows, error: tripErr } = await db
      .from("trips")
      .select(
        "id, group_id, destination_name, start_date, end_date, status, created_at"
      )
      .in("group_id", groupIds)
      .order("created_at", { ascending: false });

    if (tripErr) {
      return NextResponse.json(
        { error: "Failed to load trips", code: "DB_ERROR" },
        { status: 500 }
      );
    }

    for (const t of tripRows ?? []) {
      tripsById.set(t.id as string, {
        id: t.id as string,
        groupId: (t.group_id as string | null) ?? null,
        destinationName: (t.destination_name as string | null) ?? null,
        startDate: (t.start_date as string | null) ?? null,
        endDate: (t.end_date as string | null) ?? null,
        status: t.status as string,
        itemCount: 0,
      });
    }
  }

  // Trips reachable via direct trip_members membership.
  const { data: directRows } = await db
    .from("trip_members")
    .select(
      "trip_id, trips!inner(id, group_id, destination_name, start_date, end_date, status, created_at)"
    )
    .eq("app_user_id", auth.appUserId)
    .is("left_at", null);

  for (const row of directRows ?? []) {
    const t = Array.isArray(row.trips) ? row.trips[0] : row.trips;
    if (!t) continue;
    const id = t.id as string;
    if (tripsById.has(id)) continue;
    tripsById.set(id, {
      id,
      groupId: (t.group_id as string | null) ?? null,
      destinationName: (t.destination_name as string | null) ?? null,
      startDate: (t.start_date as string | null) ?? null,
      endDate: (t.end_date as string | null) ?? null,
      status: t.status as string,
      itemCount: 0,
    });
  }

  const tripIds = Array.from(tripsById.keys());
  if (tripIds.length > 0) {
    const { data: itemRows } = await db
      .from("trip_items")
      .select("trip_id")
      .in("trip_id", tripIds);
    for (const item of itemRows ?? []) {
      const summary = tripsById.get(item.trip_id as string);
      if (summary) summary.itemCount += 1;
    }
  }

  return NextResponse.json<AppSessionResponse>({
    lineUserId: auth.lineUserId,
    appUserId: auth.appUserId,
    email: auth.email,
    displayName,
    groups,
    trips: Array.from(tripsById.values()),
  });
}

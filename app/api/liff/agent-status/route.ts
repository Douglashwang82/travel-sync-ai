import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/db";
import { requireTripMembership } from "@/lib/liff-server";
import type { ApiError } from "@/lib/types";

const QuerySchema = z.object({
  tripId: z.string().uuid(),
});

export interface AgentStatusData {
  lastActiveAt: string | null;
  entitiesToday: number;
  itemsCreatedThisWeek: number;
  isListening: boolean;
}

/**
 * GET /api/liff/agent-status?tripId=...
 *
 * Returns agent activity metrics for the LIFF dashboard status card.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);

  const result = QuerySchema.safeParse({ tripId: searchParams.get("tripId") });
  if (!result.success) {
    return NextResponse.json<ApiError>(
      { error: "tripId is required", code: "VALIDATION_ERROR" },
      { status: 400 }
    );
  }

  const { tripId } = result.data;
  const membership = await requireTripMembership(req, tripId);
  if (!membership.ok) return membership.response;

  const db = createAdminClient();
  const groupId = membership.membership.groupId;

  // Most recent processed event for this group
  const { data: lastEvent } = await db
    .from("line_events")
    .select("processed_at")
    .eq("group_id", groupId)
    .eq("processing_status", "processed")
    .order("processed_at", { ascending: false })
    .limit(1)
    .single();

  // Entities extracted today
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const { count: entitiesToday } = await db
    .from("parsed_entities")
    .select("id", { count: "exact", head: true })
    .eq("group_id", groupId)
    .gte("created_at", todayStart.toISOString());

  // AI-created trip items this week
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - 7);
  weekStart.setHours(0, 0, 0, 0);

  const { count: itemsCreatedThisWeek } = await db
    .from("trip_items")
    .select("id", { count: "exact", head: true })
    .eq("trip_id", tripId)
    .eq("source", "ai")
    .gte("created_at", weekStart.toISOString());

  // Group listening status
  const { data: group } = await db
    .from("line_groups")
    .select("status")
    .eq("id", groupId)
    .single();

  const data: AgentStatusData = {
    lastActiveAt: lastEvent?.processed_at ?? null,
    entitiesToday: entitiesToday ?? 0,
    itemsCreatedThisWeek: itemsCreatedThisWeek ?? 0,
    isListening: group?.status === "active",
  };

  return NextResponse.json(data);
}

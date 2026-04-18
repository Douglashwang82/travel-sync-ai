import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/db";
import { requireTripMembership } from "@/lib/liff-server";
import type { ApiError } from "@/lib/types";

const QuerySchema = z.object({
  tripId: z.string().uuid(),
});

export interface GroupMemberSummary {
  lineUserId: string;
  displayName: string | null;
  role: string;
}

/**
 * GET /api/liff/members?tripId=...
 *
 * Returns all active members of the group that owns the trip.
 * Used by the dashboard assignment picker.
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

  const { data: trip } = await db
    .from("trips")
    .select("group_id")
    .eq("id", tripId)
    .single();

  if (!trip) {
    return NextResponse.json<ApiError>(
      { error: "Trip not found", code: "NOT_FOUND" },
      { status: 404 }
    );
  }

  const { data: members, error } = await db
    .from("group_members")
    .select("line_user_id, display_name, role")
    .eq("group_id", trip.group_id)
    .is("left_at", null)
    .order("role", { ascending: true })
    .order("display_name", { ascending: true });

  if (error) {
    return NextResponse.json<ApiError>(
      { error: "Failed to load members", code: "DB_ERROR" },
      { status: 500 }
    );
  }

  const result2: GroupMemberSummary[] = (members ?? []).map(
    (m: { line_user_id: string; display_name: string | null; role: string }) => ({
      lineUserId: m.line_user_id,
      displayName: m.display_name,
      role: m.role,
    })
  );

  return NextResponse.json(result2);
}

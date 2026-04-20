import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/db";
import { authenticateLiffRequest } from "@/lib/liff-server";
import type { ApiError } from "@/lib/types";

const SessionQuerySchema = z.object({
  // Optional: provided when opened from a LINE group chat.
  // When absent (private chat or external browser), the user's most recently
  // active group membership is used instead.
  lineGroupId: z.string().min(1).optional(),
  lineUserId: z.string().optional(),
  displayName: z.string().optional(),
});

/**
 * GET /api/liff/session
 *
 * Resolves LIFF user and group context.
 * Called by the LIFF app on load after LINE Login succeeds.
 *
 * Query params:
 *   lineGroupId  — LINE group ID from LIFF context (omitted in private chat / browser)
 *   lineUserId   — optional LIFF profile user ID; must match the verified token if provided
 *   displayName  — display name from LIFF profile (optional, for caching)
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await authenticateLiffRequest(req);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(req.url);

  const params = {
    lineGroupId: searchParams.get("lineGroupId") ?? undefined,
    lineUserId: searchParams.get("lineUserId") ?? undefined,
    displayName: searchParams.get("displayName") ?? undefined,
  };

  const result = SessionQuerySchema.safeParse(params);
  if (!result.success) {
    return NextResponse.json<ApiError>(
      { error: "Missing required params", code: "VALIDATION_ERROR", details: result.error.flatten() },
      { status: 400 }
    );
  }

  const { lineGroupId, lineUserId: claimedLineUserId, displayName } = result.data;
  if (claimedLineUserId && claimedLineUserId !== auth.lineUserId) {
    return NextResponse.json<ApiError>(
      { error: "LIFF user mismatch", code: "FORBIDDEN" },
      { status: 403 }
    );
  }

  const lineUserId = auth.lineUserId;
  const db = createAdminClient();

  let group: { id: string; line_group_id: string; name: string | null; status: string } | null = null;

  if (lineGroupId) {
    // Group chat context: upsert the group and use it directly
    const { data, error: groupError } = await db
      .from("line_groups")
      .upsert(
        { line_group_id: lineGroupId, last_seen_at: new Date().toISOString() },
        { onConflict: "line_group_id" }
      )
      .select("id, line_group_id, name, status")
      .single();

    if (groupError || !data) {
      console.error("[liff/session] group upsert failed", groupError);
      return NextResponse.json<ApiError>(
        { error: "Failed to resolve group", code: "DB_ERROR" },
        { status: 500 }
      );
    }
    group = data;
  } else {
    // Private chat / browser context: find the user's most recently active group
    const { data } = await db
      .from("group_members")
      .select("group_id, line_groups!inner(id, line_group_id, name, status, last_seen_at)")
      .eq("line_user_id", lineUserId)
      .is("left_at", null)
      .order("line_groups(last_seen_at)", { ascending: false })
      .limit(1)
      .single();

    if (data) {
      const lg = Array.isArray(data.line_groups) ? data.line_groups[0] : data.line_groups;
      group = lg as { id: string; line_group_id: string; name: string | null; status: string };
    }
  }

  if (!group) {
    return NextResponse.json<ApiError>(
      { error: "No group found for this user", code: "NOT_FOUND" },
      { status: 404 }
    );
  }

  // Upsert member record (preserve existing role)
  await db.from("group_members").upsert(
    {
      group_id: group.id,
      line_user_id: lineUserId,
      display_name: displayName ?? null,
    },
    { onConflict: "group_id,line_user_id" }
  );

  // Fetch current member info (to get role)
  const { data: member } = await db
    .from("group_members")
    .select("role")
    .eq("group_id", group.id)
    .eq("line_user_id", lineUserId)
    .single();

  // Fetch active trip
  const { data: trip } = await db
    .from("trips")
    .select(`
      id,
      destination_name,
      destination_place_id,
      destination_formatted_address,
      destination_google_maps_url,
      destination_lat,
      destination_lng,
      destination_timezone,
      destination_source_last_synced_at,
      start_date,
      end_date,
      status
    `)
    .eq("group_id", group.id)
    .in("status", ["draft", "active"])
    .single();

  return NextResponse.json({
    group: {
      id: group.id,
      lineGroupId: group.line_group_id,
      name: group.name,
    },
    member: {
      lineUserId,
      role: member?.role ?? "member",
    },
    activeTrip: trip ?? null,
  });
}

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/db";
import type { ApiError } from "@/lib/types";

const SessionQuerySchema = z.object({
  lineGroupId: z.string().min(1),
  lineUserId: z.string().min(1),
  displayName: z.string().optional(),
});

/**
 * GET /api/liff/session
 *
 * Resolves LIFF user and group context.
 * Called by the LIFF app on load after LINE Login succeeds.
 *
 * Query params:
 *   lineGroupId  — LINE group ID from LIFF context
 *   lineUserId   — LINE user ID from LIFF profile
 *   displayName  — display name from LIFF profile (optional, for caching)
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);

  const params = {
    lineGroupId: searchParams.get("lineGroupId") ?? "",
    lineUserId: searchParams.get("lineUserId") ?? "",
    displayName: searchParams.get("displayName") ?? undefined,
  };

  const result = SessionQuerySchema.safeParse(params);
  if (!result.success) {
    return NextResponse.json<ApiError>(
      { error: "Missing required params", code: "VALIDATION_ERROR", details: result.error.flatten() },
      { status: 400 }
    );
  }

  const { lineGroupId, lineUserId, displayName } = result.data;
  const db = createAdminClient();

  // Resolve or create group record
  const { data: group, error: groupError } = await db
    .from("line_groups")
    .upsert(
      { line_group_id: lineGroupId, last_seen_at: new Date().toISOString() },
      { onConflict: "line_group_id" }
    )
    .select("id, line_group_id, name, status")
    .single();

  if (groupError || !group) {
    console.error("[liff/session] group upsert failed", groupError);
    return NextResponse.json<ApiError>(
      { error: "Failed to resolve group", code: "DB_ERROR" },
      { status: 500 }
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
    .select("id, destination_name, start_date, end_date, status")
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

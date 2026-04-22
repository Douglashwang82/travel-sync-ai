import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/db";
import { requireAppTripAccess } from "@/lib/app-server";

type RouteContext = { params: Promise<{ tripId: string }> };

export interface AppMember {
  lineUserId: string;
  displayName: string | null;
  role: string;
  joinedAt: string;
}

export async function GET(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const { tripId } = await ctx.params;
  const auth = await requireAppTripAccess(req, tripId);
  if (!auth.ok) return auth.response;

  const db = createAdminClient();
  const { data: members, error } = await db
    .from("group_members")
    .select("line_user_id, display_name, role, joined_at")
    .eq("group_id", auth.groupId)
    .is("left_at", null)
    .order("role", { ascending: true })
    .order("display_name", { ascending: true });

  if (error) {
    return NextResponse.json(
      { error: "Failed to load members", code: "DB_ERROR" },
      { status: 500 }
    );
  }

  const result: AppMember[] = (members ?? []).map((m) => ({
    lineUserId: m.line_user_id as string,
    displayName: (m.display_name as string | null) ?? null,
    role: m.role as string,
    joinedAt: m.joined_at as string,
  }));

  return NextResponse.json({ members: result });
}

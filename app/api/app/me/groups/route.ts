import { NextRequest, NextResponse } from "next/server";
import { requireAppUser } from "@/lib/app-server";
import { createAdminClient } from "@/lib/db";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAppUser(req);
  if (!auth.ok) return auth.response;

  const db = createAdminClient();
  const { data, error } = await db
    .from("group_members")
    .select("role, line_groups(id, name, line_group_id)")
    .eq("line_user_id", auth.lineUserId)
    .is("left_at", null);

  if (error) {
    return NextResponse.json({ error: "Failed to load groups", code: "DB_ERROR" }, { status: 500 });
  }

  type GroupRow = { id: string; name: string | null; line_group_id: string };
  type MemberRow = { role: unknown; line_groups: GroupRow | null };
  const groups = (data as unknown as MemberRow[] ?? []).map((m) => {
    const g = m.line_groups;
    return {
      id: g?.id ?? "",
      name: g?.name ?? null,
      line_group_id: g?.line_group_id ?? "",
      role: m.role as string,
    };
  }).filter((g) => g.id !== "");

  return NextResponse.json({ groups });
}

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/db";
import { requireAppUser } from "@/lib/app-server";

export interface AppProfileResponse {
  appUserId: string;
  lineUserId: string;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  createdAt: string;
  updatedAt: string;
  groupCount: number;
  tripCount: number;
}

const PatchSchema = z.object({
  displayName: z.string().trim().min(1).max(80).nullable().optional(),
  avatarUrl: z
    .string()
    .trim()
    .url()
    .max(2048)
    .nullable()
    .or(z.literal(""))
    .optional(),
});

/** GET /api/app/me — return the signed-in user's profile + light stats. */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAppUser(req);
  if (!auth.ok) return auth.response;

  const db = createAdminClient();

  const { data: user, error: userErr } = await db
    .from("app_users")
    .select("id, email, display_name, line_user_id, avatar_url, created_at, updated_at")
    .eq("id", auth.appUserId)
    .single();

  if (userErr || !user) {
    return NextResponse.json(
      { error: "Failed to load profile", code: "DB_ERROR" },
      { status: 500 }
    );
  }

  const [{ count: groupCount }, { count: tripMemberCount }, { data: groupRows }] =
    await Promise.all([
      db
        .from("group_members")
        .select("id", { count: "exact", head: true })
        .eq("line_user_id", auth.lineUserId)
        .is("left_at", null),
      db
        .from("trip_members")
        .select("id", { count: "exact", head: true })
        .eq("app_user_id", auth.appUserId)
        .is("left_at", null),
      db
        .from("group_members")
        .select("group_id")
        .eq("line_user_id", auth.lineUserId)
        .is("left_at", null),
    ]);

  let tripsViaGroups = 0;
  const groupIds = (groupRows ?? []).map((r) => r.group_id as string).filter(Boolean);
  if (groupIds.length > 0) {
    const { count } = await db
      .from("trips")
      .select("id", { count: "exact", head: true })
      .in("group_id", groupIds);
    tripsViaGroups = count ?? 0;
  }

  return NextResponse.json<AppProfileResponse>({
    appUserId: user.id as string,
    lineUserId: user.line_user_id as string,
    email: (user.email as string | null) ?? null,
    displayName: (user.display_name as string | null) ?? null,
    avatarUrl: (user.avatar_url as string | null) ?? null,
    createdAt: user.created_at as string,
    updatedAt: user.updated_at as string,
    groupCount: groupCount ?? 0,
    tripCount: tripsViaGroups + (tripMemberCount ?? 0),
  });
}

/** PATCH /api/app/me — update display name and/or avatar URL. */
export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAppUser(req);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON", code: "INVALID_JSON" },
      { status: 400 }
    );
  }

  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Validation failed",
        code: "VALIDATION_ERROR",
        details: parsed.error.flatten(),
      },
      { status: 400 }
    );
  }

  const patch: Record<string, unknown> = {};
  if (parsed.data.displayName !== undefined) {
    patch.display_name = parsed.data.displayName;
  }
  if (parsed.data.avatarUrl !== undefined) {
    patch.avatar_url = parsed.data.avatarUrl === "" ? null : parsed.data.avatarUrl;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      { error: "No fields to update", code: "VALIDATION_ERROR" },
      { status: 400 }
    );
  }

  const db = createAdminClient();
  const { data, error } = await db
    .from("app_users")
    .update(patch)
    .eq("id", auth.appUserId)
    .select("id, email, display_name, line_user_id, avatar_url, created_at, updated_at")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: "Failed to update profile", code: "DB_ERROR" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    appUserId: data.id as string,
    lineUserId: data.line_user_id as string,
    email: (data.email as string | null) ?? null,
    displayName: (data.display_name as string | null) ?? null,
    avatarUrl: (data.avatar_url as string | null) ?? null,
    createdAt: data.created_at as string,
    updatedAt: data.updated_at as string,
  });
}

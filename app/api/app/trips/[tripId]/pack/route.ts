import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/db";
import { requireAppTripWithGroup } from "@/lib/app-server";
import {
  APP_PACK_CATEGORIES,
  type AppGroupPackItem,
  type AppPackCategory,
  type AppPackResponse,
  type AppPersonalPackItem,
} from "@/lib/app-pack";

type RouteContext = { params: Promise<{ tripId: string }> };

const CreateSchema = z.object({
  scope: z.enum(["group", "mine"]).default("group"),
  label: z.string().trim().min(1).max(120),
  category: z.enum(APP_PACK_CATEGORIES).default("general"),
});

export async function GET(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const { tripId } = await ctx.params;
  const auth = await requireAppTripWithGroup(req, tripId);
  if (!auth.ok) return auth.response;

  const db = createAdminClient();
  const { data: trip, error: tripErr } = await db
    .from("trips")
    .select("id, destination_name, start_date, end_date")
    .eq("id", tripId)
    .single();

  if (tripErr || !trip) {
    return NextResponse.json(
      { error: "找不到旅程", code: "NOT_FOUND" },
      { status: 404 }
    );
  }

  const { data: groupRows, error: groupErr } = await db
    .from("packing_items")
    .select("id, label, category, added_by, created_at")
    .eq("trip_id", tripId)
    .order("category", { ascending: true })
    .order("created_at", { ascending: true });

  if (groupErr) {
    return NextResponse.json(
      { error: "群組打包清單載入失敗", code: "DB_ERROR" },
      { status: 500 }
    );
  }

  const groupIds = (groupRows ?? []).map((row) => row.id as string);
  const [checksResult, membersResult, personalResult] = await Promise.all([
    groupIds.length > 0
      ? db.from("packing_checks").select("item_id, line_user_id").in("item_id", groupIds)
      : Promise.resolve({ data: [], error: null }),
    db
      .from("group_members")
      .select("line_user_id, display_name")
      .eq("group_id", auth.groupId)
      .is("left_at", null),
    db
      .from("personal_packing_items")
      .select("id, label, category, is_packed, packed_at, position, created_at")
      .eq("trip_id", tripId)
      .eq("line_user_id", auth.lineUserId)
      .order("is_packed", { ascending: true })
      .order("position", { ascending: true })
      .order("created_at", { ascending: true }),
  ]);

  if (checksResult.error || membersResult.error || personalResult.error) {
    return NextResponse.json(
      { error: "打包清單載入失敗", code: "DB_ERROR" },
      { status: 500 }
    );
  }

  const checkCounts = new Map<string, number>();
  const myChecked = new Set<string>();
  for (const check of checksResult.data ?? []) {
    const itemId = check.item_id as string;
    checkCounts.set(itemId, (checkCounts.get(itemId) ?? 0) + 1);
    if (check.line_user_id === auth.lineUserId) myChecked.add(itemId);
  }

  const displayNames = new Map<string, string | null>();
  for (const member of membersResult.data ?? []) {
    displayNames.set(
      member.line_user_id as string,
      (member.display_name as string | null) ?? null
    );
  }

  const groupItems: AppGroupPackItem[] = (groupRows ?? []).map((row) => {
    const addedBy = (row.added_by as string | null) ?? null;
    return {
      id: row.id as string,
      label: row.label as string,
      category: normalizeCategory(row.category),
      addedBy,
      addedByName: addedBy ? displayNames.get(addedBy) ?? null : null,
      createdAt: row.created_at as string,
      isPackedByMe: myChecked.has(row.id as string),
      packedCount: checkCounts.get(row.id as string) ?? 0,
      canDelete: auth.role === "organizer" || addedBy === auth.lineUserId,
    };
  });

  const personalItems: AppPersonalPackItem[] = (personalResult.data ?? []).map((row) => ({
    id: row.id as string,
    label: row.label as string,
    category: normalizeCategory(row.category),
    isPacked: Boolean(row.is_packed),
    packedAt: (row.packed_at as string | null) ?? null,
    position: Number(row.position ?? 0),
    createdAt: row.created_at as string,
  }));

  return NextResponse.json<AppPackResponse>({
    trip: {
      id: trip.id as string,
      destinationName: (trip.destination_name as string | null) ?? null,
      startDate: (trip.start_date as string | null) ?? null,
      endDate: (trip.end_date as string | null) ?? null,
    },
    currentUser: {
      lineUserId: auth.lineUserId,
      role: auth.role,
    },
    groupItems,
    personalItems,
    groupPackedCount: groupItems.filter((item) => item.isPackedByMe).length,
    personalPackedCount: personalItems.filter((item) => item.isPacked).length,
  });
}

export async function POST(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const { tripId } = await ctx.params;
  const auth = await requireAppTripWithGroup(req, tripId);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "JSON 格式無效", code: "INVALID_JSON" },
      { status: 400 }
    );
  }

  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "資料驗證失敗", code: "VALIDATION_ERROR", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const db = createAdminClient();
  if (parsed.data.scope === "group") {
    const { error } = await db.from("packing_items").insert({
      trip_id: tripId,
      group_id: auth.groupId,
      label: parsed.data.label,
      category: parsed.data.category,
      is_shared: true,
      added_by: auth.lineUserId,
    });

    if (error) {
      return NextResponse.json(
        { error: "新增群組物品失敗", code: "DB_ERROR" },
        { status: 500 }
      );
    }
  } else {
    const { data: maxRow } = await db
      .from("personal_packing_items")
      .select("position")
      .eq("trip_id", tripId)
      .eq("line_user_id", auth.lineUserId)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();

    const nextPosition = (Number(maxRow?.position ?? 0) || 0) + 1;
    const { error } = await db.from("personal_packing_items").insert({
      trip_id: tripId,
      line_user_id: auth.lineUserId,
      label: parsed.data.label,
      category: parsed.data.category,
      position: nextPosition,
    });

    if (error) {
      return NextResponse.json(
        { error: "新增私人物品失敗", code: "DB_ERROR" },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}

function normalizeCategory(value: unknown): AppPackCategory {
  return APP_PACK_CATEGORIES.includes(value as AppPackCategory)
    ? (value as AppPackCategory)
    : "general";
}

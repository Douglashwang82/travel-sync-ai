import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/db";
import { requireAppTripAccess } from "@/lib/app-server";

type RouteContext = { params: Promise<{ tripId: string; itemId: string }> };

const ParamsSchema = z.object({
  tripId: z.string().uuid(),
  itemId: z.string().uuid(),
});

const PatchSchema = z.object({
  scope: z.enum(["group", "mine"]),
  isPacked: z.boolean(),
});

const DeleteSchema = z.object({
  scope: z.enum(["group", "mine"]),
});

export async function PATCH(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const params = await ctx.params;
  const parsedParams = ParamsSchema.safeParse(params);
  if (!parsedParams.success) {
    return NextResponse.json(
      { error: "物品 ID 無效", code: "VALIDATION_ERROR" },
      { status: 400 }
    );
  }

  const auth = await requireAppTripAccess(req, parsedParams.data.tripId);
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

  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "資料驗證失敗", code: "VALIDATION_ERROR", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const db = createAdminClient();
  if (parsed.data.scope === "group") {
    const { data: item, error: itemErr } = await db
      .from("packing_items")
      .select("id")
      .eq("id", parsedParams.data.itemId)
      .eq("trip_id", parsedParams.data.tripId)
      .maybeSingle();

    if (itemErr) {
      return NextResponse.json(
        { error: "物品載入失敗", code: "DB_ERROR" },
        { status: 500 }
      );
    }
    if (!item) {
      return NextResponse.json(
        { error: "找不到物品", code: "NOT_FOUND" },
        { status: 404 }
      );
    }

    if (parsed.data.isPacked) {
      const { error } = await db.from("packing_checks").upsert(
        { item_id: parsedParams.data.itemId, line_user_id: auth.lineUserId },
        { onConflict: "item_id,line_user_id", ignoreDuplicates: true }
      );
      if (error) {
        return NextResponse.json(
          { error: "標記物品失敗", code: "DB_ERROR" },
          { status: 500 }
        );
      }
    } else {
      const { error } = await db
        .from("packing_checks")
        .delete()
        .eq("item_id", parsedParams.data.itemId)
        .eq("line_user_id", auth.lineUserId);
      if (error) {
        return NextResponse.json(
          { error: "取消標記物品失敗", code: "DB_ERROR" },
          { status: 500 }
        );
      }
    }
  } else {
    const updates = {
      is_packed: parsed.data.isPacked,
      packed_at: parsed.data.isPacked ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await db
      .from("personal_packing_items")
      .update(updates)
      .eq("id", parsedParams.data.itemId)
      .eq("trip_id", parsedParams.data.tripId)
      .eq("line_user_id", auth.lineUserId)
      .select("id")
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        { error: "更新物品失敗", code: "DB_ERROR" },
        { status: 500 }
      );
    }
    if (!data) {
      return NextResponse.json(
        { error: "找不到物品", code: "NOT_FOUND" },
        { status: 404 }
      );
    }
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const params = await ctx.params;
  const parsedParams = ParamsSchema.safeParse(params);
  if (!parsedParams.success) {
    return NextResponse.json(
      { error: "物品 ID 無效", code: "VALIDATION_ERROR" },
      { status: 400 }
    );
  }

  const auth = await requireAppTripAccess(req, parsedParams.data.tripId);
  if (!auth.ok) return auth.response;

  const parsed = DeleteSchema.safeParse({
    scope: new URL(req.url).searchParams.get("scope"),
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "缺少清單範圍", code: "VALIDATION_ERROR" },
      { status: 400 }
    );
  }

  const db = createAdminClient();
  if (parsed.data.scope === "group") {
    const { data: item, error: itemErr } = await db
      .from("packing_items")
      .select("id, added_by")
      .eq("id", parsedParams.data.itemId)
      .eq("trip_id", parsedParams.data.tripId)
      .maybeSingle();

    if (itemErr) {
      return NextResponse.json(
        { error: "物品載入失敗", code: "DB_ERROR" },
        { status: 500 }
      );
    }
    if (!item) {
      return NextResponse.json(
        { error: "找不到物品", code: "NOT_FOUND" },
        { status: 404 }
      );
    }
    if (auth.role !== "organizer" && item.added_by !== auth.lineUserId) {
      return NextResponse.json(
        { error: "只能刪除你新增的物品", code: "FORBIDDEN" },
        { status: 403 }
      );
    }

    const { error } = await db
      .from("packing_items")
      .delete()
      .eq("id", parsedParams.data.itemId)
      .eq("trip_id", parsedParams.data.tripId);

    if (error) {
      return NextResponse.json(
        { error: "刪除物品失敗", code: "DB_ERROR" },
        { status: 500 }
      );
    }
  } else {
    const { error } = await db
      .from("personal_packing_items")
      .delete()
      .eq("id", parsedParams.data.itemId)
      .eq("trip_id", parsedParams.data.tripId)
      .eq("line_user_id", auth.lineUserId);

    if (error) {
      return NextResponse.json(
        { error: "刪除物品失敗", code: "DB_ERROR" },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ ok: true });
}

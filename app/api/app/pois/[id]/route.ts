import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/app-server";
import { createAdminClient } from "@/lib/db";
import {
  SAVED_POI_TYPES,
  rowToSavedPoi,
  type SavedPoi,
} from "@/lib/app-pois";

type RouteContext = { params: Promise<{ id: string }> };

const SELECT =
  "id, place_id, name, item_type, address, lat, lng, notes, source, destination_name, google_maps_url, created_at";

const PatchSchema = z
  .object({
    notes: z.string().max(1000).nullish(),
    itemType: z.enum(SAVED_POI_TYPES).optional(),
    name: z.string().trim().min(1).max(200).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "至少需要一個欄位",
  });

/**
 * PATCH /api/app/pois/[id]
 *
 * Edits a saved POI the user owns (notes / item type / name). Ownership-scoped:
 * the row must belong to the signed-in user or a 404 is returned.
 */
export async function PATCH(
  req: NextRequest,
  ctx: RouteContext
): Promise<NextResponse> {
  const auth = await requireAppUser(req);
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;

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
      {
        error: "資料驗證失敗",
        code: "VALIDATION_ERROR",
        details: parsed.error.flatten(),
      },
      { status: 400 }
    );
  }

  const updates: Record<string, unknown> = {};
  if (parsed.data.notes !== undefined) updates.notes = parsed.data.notes ?? null;
  if (parsed.data.itemType !== undefined) updates.item_type = parsed.data.itemType;
  if (parsed.data.name !== undefined) updates.name = parsed.data.name;

  const db = createAdminClient();
  const { data, error } = await db
    .from("user_saved_pois")
    .update(updates)
    .eq("id", id)
    .eq("line_user_id", auth.lineUserId)
    .select(SELECT)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: "更新地點失敗", code: "DB_ERROR" },
      { status: 500 }
    );
  }
  if (!data) {
    return NextResponse.json(
      { error: "找不到地點", code: "NOT_FOUND" },
      { status: 404 }
    );
  }

  return NextResponse.json<{ poi: SavedPoi }>({ poi: rowToSavedPoi(data) });
}

/**
 * DELETE /api/app/pois/[id]
 *
 * Removes a saved POI the user owns. Ownership-scoped via line_user_id.
 */
export async function DELETE(
  req: NextRequest,
  ctx: RouteContext
): Promise<NextResponse> {
  const auth = await requireAppUser(req);
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;

  const db = createAdminClient();
  const { data, error } = await db
    .from("user_saved_pois")
    .delete()
    .eq("id", id)
    .eq("line_user_id", auth.lineUserId)
    .select("id")
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: "刪除地點失敗", code: "DB_ERROR" },
      { status: 500 }
    );
  }
  if (!data) {
    return NextResponse.json(
      { error: "找不到地點", code: "NOT_FOUND" },
      { status: 404 }
    );
  }

  return NextResponse.json({ ok: true });
}

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/db";
import { authenticateLiffRequest } from "@/lib/liff-server";
import type { ApiError } from "@/lib/types";
import type { PackItem, PackCategory } from "../route";

const PatchSchema = z.object({
  isPacked: z.boolean().optional(),
  label: z.string().trim().min(1).max(120).optional(),
  category: z
    .enum(["documents", "clothing", "toiletries", "electronics", "health", "general"])
    .optional(),
});

const ParamsSchema = z.object({ itemId: z.string().uuid() });

async function loadOwnedItem(itemId: string, lineUserId: string) {
  const db = createAdminClient();
  const { data, error } = await db
    .from("personal_packing_items")
    .select("id, line_user_id")
    .eq("id", itemId)
    .maybeSingle();

  if (error) return { error: "DB_ERROR" as const };
  if (!data) return { error: "NOT_FOUND" as const };
  if (data.line_user_id !== lineUserId) return { error: "FORBIDDEN" as const };
  return { db };
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ itemId: string }> }
): Promise<NextResponse> {
  const auth = await authenticateLiffRequest(req);
  if (!auth.ok) return auth.response;

  const params = await ctx.params;
  const parsedParams = ParamsSchema.safeParse(params);
  if (!parsedParams.success) {
    return NextResponse.json<ApiError>(
      { error: "Invalid item id", code: "VALIDATION_ERROR" },
      { status: 400 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json<ApiError>(
      { error: "Invalid JSON", code: "INVALID_JSON" },
      { status: 400 }
    );
  }

  const parsedBody = PatchSchema.safeParse(body);
  if (!parsedBody.success) {
    return NextResponse.json<ApiError>(
      { error: "Validation failed", code: "VALIDATION_ERROR", details: parsedBody.error.flatten() },
      { status: 400 }
    );
  }

  const owned = await loadOwnedItem(parsedParams.data.itemId, auth.lineUserId);
  if ("error" in owned) {
    const status =
      owned.error === "NOT_FOUND" ? 404 : owned.error === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json<ApiError>(
      {
        error:
          owned.error === "NOT_FOUND"
            ? "Item not found"
            : owned.error === "FORBIDDEN"
              ? "You do not own this item"
              : "Database error",
        code: owned.error,
      },
      { status }
    );
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (parsedBody.data.label !== undefined) updates.label = parsedBody.data.label;
  if (parsedBody.data.category !== undefined) updates.category = parsedBody.data.category;
  if (parsedBody.data.isPacked !== undefined) {
    updates.is_packed = parsedBody.data.isPacked;
    updates.packed_at = parsedBody.data.isPacked ? new Date().toISOString() : null;
  }

  const { data: updated, error } = await owned.db
    .from("personal_packing_items")
    .update(updates)
    .eq("id", parsedParams.data.itemId)
    .eq("line_user_id", auth.lineUserId)
    .select("id, trip_id, label, category, is_packed, packed_at, position, created_at")
    .single();

  if (error || !updated) {
    return NextResponse.json<ApiError>(
      { error: "Failed to update item", code: "DB_ERROR" },
      { status: 500 }
    );
  }

  const item: PackItem = {
    id: updated.id as string,
    tripId: updated.trip_id as string,
    label: updated.label as string,
    category: updated.category as PackCategory,
    isPacked: Boolean(updated.is_packed),
    packedAt: (updated.packed_at as string | null) ?? null,
    position: Number(updated.position ?? 0),
    createdAt: updated.created_at as string,
  };

  return NextResponse.json(item);
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ itemId: string }> }
): Promise<NextResponse> {
  const auth = await authenticateLiffRequest(req);
  if (!auth.ok) return auth.response;

  const params = await ctx.params;
  const parsedParams = ParamsSchema.safeParse(params);
  if (!parsedParams.success) {
    return NextResponse.json<ApiError>(
      { error: "Invalid item id", code: "VALIDATION_ERROR" },
      { status: 400 }
    );
  }

  const owned = await loadOwnedItem(parsedParams.data.itemId, auth.lineUserId);
  if ("error" in owned) {
    const status =
      owned.error === "NOT_FOUND" ? 404 : owned.error === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json<ApiError>(
      {
        error:
          owned.error === "NOT_FOUND"
            ? "Item not found"
            : owned.error === "FORBIDDEN"
              ? "You do not own this item"
              : "Database error",
        code: owned.error,
      },
      { status }
    );
  }

  const { error } = await owned.db
    .from("personal_packing_items")
    .delete()
    .eq("id", parsedParams.data.itemId)
    .eq("line_user_id", auth.lineUserId);

  if (error) {
    return NextResponse.json<ApiError>(
      { error: "Failed to delete item", code: "DB_ERROR" },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}

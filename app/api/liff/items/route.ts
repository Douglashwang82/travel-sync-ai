import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/db";
import { requireOrganizerForItem, requireOrganizerForTrip } from "@/lib/liff-server";
import {
  createItem,
  updateItem,
  deleteItem,
  reopenItem,
} from "@/services/trip-state";
import type { ApiError, ItemType } from "@/lib/types";

// ─── Schemas ─────────────────────────────────────────────────────────────────

const ItemTypeEnum = z.enum([
  "hotel",
  "restaurant",
  "activity",
  "transport",
  "insurance",
  "flight",
  "other",
]);

const CreateItemSchema = z.object({
  action: z.literal("create"),
  tripId: z.string().uuid(),
  title: z.string().min(1).max(200),
  itemType: ItemTypeEnum.optional(),
  description: z.string().max(1000).optional(),
});

const UpdateItemSchema = z.object({
  action: z.literal("update"),
  itemId: z.string().uuid(),
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).nullable().optional(),
  itemType: ItemTypeEnum.optional(),
  deadlineAt: z.string().datetime().nullable().optional(),
});

const ReopenItemSchema = z.object({
  action: z.literal("reopen"),
  itemId: z.string().uuid(),
});

const DeleteItemSchema = z.object({
  action: z.literal("delete"),
  itemId: z.string().uuid(),
});

const BodySchema = z.discriminatedUnion("action", [
  CreateItemSchema,
  UpdateItemSchema,
  ReopenItemSchema,
  DeleteItemSchema,
]);

// ─── Route ────────────────────────────────────────────────────────────────────

/**
 * POST /api/liff/items
 *
 * Unified board item mutation endpoint.
 * action: "create" | "update" | "reopen" | "delete"
 *
 * Note: "create" requires tripId from the LIFF session.
 * Stage transitions to "pending" (vote) go through /api/liff/votes (Phase 4).
 * Stage transition to "confirmed" is handled by the vote closure job.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json<ApiError>(
      { error: "Invalid JSON", code: "INVALID_JSON" },
      { status: 400 }
    );
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json<ApiError>(
      { error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const data = parsed.data;

  switch (data.action) {
    case "create": {
      const auth = await requireOrganizerForTrip(req, data.tripId);
      if (!auth.ok) return auth.response;

      // Verify the trip exists before creating an item
      const db = createAdminClient();
      const { data: trip } = await db
        .from("trips")
        .select("id")
        .eq("id", data.tripId)
        .in("status", ["draft", "active"])
        .single();

      if (!trip) {
        return NextResponse.json<ApiError>(
          { error: "Active trip not found", code: "NOT_FOUND" },
          { status: 404 }
        );
      }

      const result = await createItem({
        tripId: data.tripId,
        title: data.title,
        itemType: data.itemType as ItemType | undefined,
        description: data.description,
        source: "manual",
      });

      if (!result.ok) {
        return NextResponse.json<ApiError>(
          { error: result.error, code: result.code },
          { status: 500 }
        );
      }
      return NextResponse.json(result.item, { status: 201 });
    }

    case "update": {
      const auth = await requireOrganizerForItem(req, data.itemId);
      if (!auth.ok) return auth.response;

      const result = await updateItem(data.itemId, {
        title: data.title,
        description: data.description ?? undefined,
        itemType: data.itemType as ItemType | undefined,
        deadlineAt: data.deadlineAt ?? undefined,
      });

      if (!result.ok) {
        return NextResponse.json<ApiError>(
          { error: result.error, code: result.code },
          { status: result.code === "NOT_FOUND" ? 404 : 500 }
        );
      }
      return NextResponse.json(result.item);
    }

    case "reopen": {
      const auth = await requireOrganizerForItem(req, data.itemId);
      if (!auth.ok) return auth.response;

      const result = await reopenItem(data.itemId);
      if (!result.ok) {
        return NextResponse.json<ApiError>(
          { error: result.error, code: result.code },
          { status: result.code === "NOT_FOUND" ? 404 : 500 }
        );
      }
      return NextResponse.json(result.item);
    }

    case "delete": {
      const auth = await requireOrganizerForItem(req, data.itemId);
      if (!auth.ok) return auth.response;

      const result = await deleteItem(data.itemId);
      if (!result.ok) {
        return NextResponse.json<ApiError>(
          { error: result.error ?? "Failed to delete", code: "DB_ERROR" },
          { status: 500 }
        );
      }
      return new NextResponse(null, { status: 204 });
    }
  }
}

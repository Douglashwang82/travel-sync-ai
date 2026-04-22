import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/db";
import {
  requireAppOrganizer,
  requireAppOrganizerForItem,
  requireAppTripAccessForItem,
} from "@/lib/app-server";
import {
  createItem,
  updateItem,
  deleteItem,
  reopenItem,
  confirmBooking,
} from "@/services/trip-state";
import type { ItemType } from "@/lib/types";

type RouteContext = { params: Promise<{ tripId: string }> };

const ItemTypeEnum = z.enum([
  "hotel",
  "restaurant",
  "activity",
  "transport",
  "insurance",
  "flight",
  "other",
]);

const CreateSchema = z.object({
  action: z.literal("create"),
  title: z.string().min(1).max(200),
  itemType: ItemTypeEnum.optional(),
  description: z.string().max(1000).optional(),
  deadlineAt: z.string().datetime().nullable().optional(),
});

const UpdateSchema = z.object({
  action: z.literal("update"),
  itemId: z.string().uuid(),
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).nullable().optional(),
  itemType: ItemTypeEnum.optional(),
  deadlineAt: z.string().datetime().nullable().optional(),
  assignedTo: z.string().min(1).nullable().optional(),
});

const ReopenSchema = z.object({
  action: z.literal("reopen"),
  itemId: z.string().uuid(),
});

const DeleteSchema = z.object({
  action: z.literal("delete"),
  itemId: z.string().uuid(),
});

const MarkBookedSchema = z.object({
  action: z.literal("mark_booked"),
  itemId: z.string().uuid(),
  bookingRef: z.string().min(1).max(500),
});

const BodySchema = z.discriminatedUnion("action", [
  CreateSchema,
  UpdateSchema,
  ReopenSchema,
  DeleteSchema,
  MarkBookedSchema,
]);

export async function POST(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const { tripId } = await ctx.params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON", code: "INVALID_JSON" },
      { status: 400 }
    );
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const data = parsed.data;

  switch (data.action) {
    case "create": {
      const auth = await requireAppOrganizer(req, tripId);
      if (!auth.ok) return auth.response;

      const db = createAdminClient();
      const { data: trip } = await db
        .from("trips")
        .select("id")
        .eq("id", tripId)
        .in("status", ["draft", "active"])
        .single();

      if (!trip) {
        return NextResponse.json(
          { error: "Active trip not found", code: "NOT_FOUND" },
          { status: 404 }
        );
      }

      const result = await createItem({
        tripId,
        title: data.title,
        itemType: data.itemType as ItemType | undefined,
        description: data.description,
        deadlineAt: data.deadlineAt ?? undefined,
        source: "manual",
      });

      if (!result.ok) {
        return NextResponse.json(
          { error: result.error, code: result.code },
          { status: 500 }
        );
      }
      return NextResponse.json(result.item, { status: 201 });
    }

    case "update": {
      const auth = await requireAppOrganizerForItem(req, data.itemId);
      if (!auth.ok) return auth.response;

      const result = await updateItem(data.itemId, {
        title: data.title,
        description: data.description ?? undefined,
        itemType: data.itemType as ItemType | undefined,
        deadlineAt: data.deadlineAt ?? undefined,
        assignedToLineUserId: data.assignedTo ?? undefined,
      });

      if (!result.ok) {
        return NextResponse.json(
          { error: result.error, code: result.code },
          { status: result.code === "NOT_FOUND" ? 404 : 500 }
        );
      }
      return NextResponse.json(result.item);
    }

    case "reopen": {
      const auth = await requireAppOrganizerForItem(req, data.itemId);
      if (!auth.ok) return auth.response;

      const result = await reopenItem(data.itemId);
      if (!result.ok) {
        return NextResponse.json(
          { error: result.error, code: result.code },
          { status: result.code === "NOT_FOUND" ? 404 : 500 }
        );
      }
      return NextResponse.json(result.item);
    }

    case "delete": {
      const auth = await requireAppOrganizerForItem(req, data.itemId);
      if (!auth.ok) return auth.response;

      const result = await deleteItem(data.itemId);
      if (!result.ok) {
        return NextResponse.json(
          { error: result.error ?? "Failed to delete", code: "DB_ERROR" },
          { status: 500 }
        );
      }
      return new NextResponse(null, { status: 204 });
    }

    case "mark_booked": {
      const auth = await requireAppTripAccessForItem(req, data.itemId);
      if (!auth.ok) return auth.response;

      const result = await confirmBooking({
        itemId: data.itemId,
        bookingRef: data.bookingRef,
        bookedByLineUserId: auth.lineUserId,
      });

      if (!result.ok) {
        const status =
          result.code === "NOT_FOUND"
            ? 404
            : result.code === "INVALID_STAGE" || result.code === "NOT_BOOKABLE"
              ? 422
              : result.code === "ALREADY_BOOKED"
                ? 409
                : 500;
        return NextResponse.json(
          { error: result.error, code: result.code },
          { status }
        );
      }
      return NextResponse.json(result.item);
    }
  }
}

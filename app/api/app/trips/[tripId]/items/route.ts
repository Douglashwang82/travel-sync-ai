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
  moveItemStage,
  deleteItem,
  reopenItem,
  confirmBooking,
} from "@/services/trip-state";
import { rememberPlace } from "@/services/memory";
import type { ItemKind, ItemStage, ItemType } from "@/lib/types";

const PLACE_ITEM_TYPES: ReadonlyArray<ItemType> = [
  "hotel",
  "restaurant",
  "activity",
  "transport",
  "flight",
];

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

const ItemKindEnum = z.enum(["task", "decision"]);

const PlaceSchema = z.object({
  name: z.string().min(1).max(200),
  address: z.string().max(400).optional().nullable(),
  lat: z.number().gte(-90).lte(90).optional().nullable(),
  lng: z.number().gte(-180).lte(180).optional().nullable(),
  googleMapsUrl: z.string().url().max(1000).optional().nullable(),
});

const CreateSchema = z.object({
  action: z.literal("create"),
  title: z.string().min(1).max(200),
  itemType: ItemTypeEnum.optional(),
  itemKind: ItemKindEnum.optional(),
  description: z.string().max(1000).optional(),
  deadlineAt: z.string().datetime().nullable().optional(),
  fromSuggestion: z.boolean().optional(),
  place: PlaceSchema.optional(),
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

const MoveStageSchema = z.object({
  action: z.literal("move_stage"),
  itemId: z.string().uuid(),
  stage: z.enum(["todo", "pending", "confirmed"]),
});

const BodySchema = z.discriminatedUnion("action", [
  CreateSchema,
  UpdateSchema,
  MoveStageSchema,
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
        .select("id, group_id")
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
        itemKind: data.itemKind as ItemKind | undefined,
        description: data.description,
        deadlineAt: data.deadlineAt ?? undefined,
        source: data.fromSuggestion ? "ai" : "manual",
      });

      if (!result.ok) {
        return NextResponse.json(
          { error: result.error, code: result.code },
          { status: 500 }
        );
      }

      // If the caller attached a specific place, materialize it as a
      // confirmed option so the new item is immediately mappable. We bypass
      // `addOption` (which restricts to decision items) and write directly.
      if (data.place) {
        const { data: opt, error: optErr } = await db
          .from("trip_item_options")
          .insert({
            trip_item_id: result.item.id,
            provider: "manual",
            name: data.place.name,
            address: data.place.address ?? null,
            lat: data.place.lat ?? null,
            lng: data.place.lng ?? null,
            google_maps_url: data.place.googleMapsUrl ?? null,
          })
          .select("id")
          .single();

        if (optErr || !opt) {
          console.error("[items.create] failed to insert seed option", optErr);
        } else {
          const { error: linkErr } = await db
            .from("trip_items")
            .update({ confirmed_option_id: opt.id })
            .eq("id", result.item.id);
          if (linkErr) {
            console.error("[items.create] failed to link confirmed option", linkErr);
          }
        }
      }

      // Once a suggested item is materialized, record it in trip_memories so
      // future suggestion runs see it as part of the group's known places and
      // avoid re-suggesting it.
      if (
        data.fromSuggestion &&
        PLACE_ITEM_TYPES.includes(result.item.item_type as ItemType)
      ) {
        try {
          await rememberPlace({
            tripId,
            groupId: trip.group_id as string,
            itemType: result.item.item_type as ItemType,
            title: result.item.title,
            summary: result.item.description ?? undefined,
            sourceLineUserId: auth.lineUserId,
          });
        } catch (err) {
          // Memory write is best-effort; don't fail item creation on it.
          console.error("[items.create] rememberPlace failed:", err);
        }
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

    case "move_stage": {
      const auth = await requireAppOrganizerForItem(req, data.itemId);
      if (!auth.ok) return auth.response;

      const result = await moveItemStage(data.itemId, data.stage as ItemStage);
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

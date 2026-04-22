import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/db";
import { requireAppOrganizer } from "@/lib/app-server";
import { startVote } from "@/services/trip-state";
import type { TripItem } from "@/lib/types";

type RouteContext = { params: Promise<{ tripId: string; itemId: string }> };

const OptionSchema = z.object({
  name: z.string().min(1).max(200),
  address: z.string().max(400).optional(),
  imageUrl: z.string().url().max(1000).optional(),
  bookingUrl: z.string().url().max(1000).optional(),
});

const BodySchema = z.object({
  deadlineAt: z.string().datetime(),
  options: z.array(OptionSchema).min(2).max(10),
});

/**
 * POST /api/app/trips/:tripId/items/:itemId/start-vote
 *
 * Organizer-only. Converts a To-Do item into an active vote:
 *   1. Upgrades item_kind to 'decision' if needed (requires no existing votes).
 *   2. Inserts the provided options (de-duplicated by name, case-insensitive).
 *   3. Calls startVote() to transition todo → pending with the deadline.
 *
 * Returns the updated item plus the inserted option rows so the caller can
 * render the new vote without another round-trip.
 */
export async function POST(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const { tripId, itemId } = await ctx.params;
  const auth = await requireAppOrganizer(req, tripId);
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

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const db = createAdminClient();

  const { data: item } = await db
    .from("trip_items")
    .select("id, trip_id, stage, item_kind")
    .eq("id", itemId)
    .single();

  if (!item || item.trip_id !== tripId) {
    return NextResponse.json(
      { error: "Item not found in this trip", code: "NOT_FOUND" },
      { status: 404 }
    );
  }

  if (item.stage !== "todo") {
    return NextResponse.json(
      {
        error: `Item is already ${item.stage} — cannot start a new vote`,
        code: "INVALID_STAGE",
      },
      { status: 422 }
    );
  }

  // De-dup options by lower-cased name.
  const seen = new Set<string>();
  const uniqueOptions = parsed.data.options.filter((o) => {
    const key = o.name.trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (uniqueOptions.length < 2) {
    return NextResponse.json(
      {
        error: "Need at least two distinct options to start a vote",
        code: "NOT_ENOUGH_OPTIONS",
      },
      { status: 400 }
    );
  }

  if (item.item_kind !== "decision") {
    const { error: kindErr } = await db
      .from("trip_items")
      .update({ item_kind: "decision" })
      .eq("id", itemId);
    if (kindErr) {
      return NextResponse.json(
        { error: "Failed to promote item to a decision", code: "DB_ERROR" },
        { status: 500 }
      );
    }
  }

  // Clear any pre-existing options on a to-do item — we control this shape.
  const { error: clearErr } = await db
    .from("trip_item_options")
    .delete()
    .eq("trip_item_id", itemId);
  if (clearErr) {
    return NextResponse.json(
      { error: "Failed to reset existing options", code: "DB_ERROR" },
      { status: 500 }
    );
  }

  const optionRows = uniqueOptions.map((o) => ({
    trip_item_id: itemId,
    provider: "manual" as const,
    name: o.name.trim(),
    address: o.address?.trim() || null,
    image_url: o.imageUrl || null,
    booking_url: o.bookingUrl || null,
  }));

  const { data: inserted, error: optErr } = await db
    .from("trip_item_options")
    .insert(optionRows)
    .select("id, name, address, image_url, booking_url");

  if (optErr || !inserted) {
    return NextResponse.json(
      { error: "Failed to insert options", code: "DB_ERROR" },
      { status: 500 }
    );
  }

  const transition = await startVote(itemId, parsed.data.deadlineAt);
  if (!transition.ok) {
    return NextResponse.json(
      { error: transition.error, code: transition.code },
      { status: transition.code === "NOT_FOUND" ? 404 : 500 }
    );
  }

  return NextResponse.json<{ item: TripItem; options: typeof inserted }>({
    item: transition.item,
    options: inserted,
  });
}

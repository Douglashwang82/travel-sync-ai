import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/db";
import { requireAppTripAccess, requireAppOrganizer } from "@/lib/app-server";
import type { Trip } from "@/lib/types";

const TripPatchSchema = z
  .object({
    title: z.string().min(1).max(200).nullable().optional(),
    destinationName: z.string().min(1).max(200).nullable().optional(),
    departureName: z.string().min(1).max(200).nullable().optional(),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    status: z.enum(["draft", "active", "completed", "cancelled"]).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "At least one field must be provided",
  });

type RouteContext = { params: Promise<{ tripId: string }> };

/** GET /api/app/trips/:tripId — full trip row for overview header and settings. */
export async function GET(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const { tripId } = await ctx.params;
  const auth = await requireAppTripAccess(req, tripId);
  if (!auth.ok) return auth.response;

  const db = createAdminClient();
  const { data, error } = await db
    .from("trips")
    .select("*")
    .eq("id", tripId)
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: "Trip not found", code: "NOT_FOUND" },
      { status: 404 }
    );
  }

  return NextResponse.json<{ trip: Trip; role: string }>({
    trip: data as Trip,
    role: auth.role,
  });
}

/**
 * PATCH /api/app/trips/:tripId — edits to title, dates, destination, departure, status.
 * Any trip member (organizer or member) may edit. Status changes still flow through here.
 */
export async function PATCH(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const { tripId } = await ctx.params;
  const auth = await requireAppTripAccess(req, tripId);
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

  const parsed = TripPatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const patch: Record<string, unknown> = {};
  if (parsed.data.title !== undefined) patch.title = parsed.data.title;
  if (parsed.data.destinationName !== undefined) patch.destination_name = parsed.data.destinationName;
  if (parsed.data.departureName !== undefined) patch.departure_name = parsed.data.departureName;
  if (parsed.data.startDate !== undefined) patch.start_date = parsed.data.startDate;
  if (parsed.data.endDate !== undefined) patch.end_date = parsed.data.endDate;
  if (parsed.data.status !== undefined) patch.status = parsed.data.status;

  if (
    patch.start_date &&
    patch.end_date &&
    typeof patch.start_date === "string" &&
    typeof patch.end_date === "string" &&
    patch.start_date > patch.end_date
  ) {
    return NextResponse.json(
      { error: "Start date must be on or before end date", code: "VALIDATION_ERROR" },
      { status: 400 }
    );
  }

  const db = createAdminClient();
  const { data, error } = await db
    .from("trips")
    .update(patch)
    .eq("id", tripId)
    .select("*")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: "Failed to update trip", code: "DB_ERROR" },
      { status: 500 }
    );
  }

  return NextResponse.json<{ trip: Trip }>({ trip: data as Trip });
}

/**
 * DELETE /api/app/trips/:tripId — hard-delete a trip. Organizer only.
 *
 * Child rows (trip_items, votes, trip_members, trip_memories, trip_ideas,
 * travel_documents, packing_items, trip_tickets, trip_orchestrators,
 * custom_grids, trip_chat_threads, calendar_events, …) cascade via FK
 * constraints. Historical expenses set `trip_id` to null so the ledger
 * stays intact.
 */
export async function DELETE(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const { tripId } = await ctx.params;
  const auth = await requireAppOrganizer(req, tripId);
  if (!auth.ok) return auth.response;

  const db = createAdminClient();
  const { error } = await db.from("trips").delete().eq("id", tripId);
  if (error) {
    return NextResponse.json(
      { error: "Failed to delete trip", code: "DB_ERROR" },
      { status: 500 }
    );
  }

  return new NextResponse(null, { status: 204 });
}

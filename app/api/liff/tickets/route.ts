import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/db";
import { requireTripMembership, requireOrganizerForTrip } from "@/lib/liff-server";
import type { ApiError, TripTicket, TicketType } from "@/lib/types";

// ─── Schemas ─────────────────────────────────────────────────────────────────

const TicketTypeEnum = z.enum([
  "flight",
  "train",
  "bus",
  "ferry",
  "museum",
  "attraction",
  "event",
  "accommodation",
  "other",
]);

const CreateTicketSchema = z.object({
  action: z.literal("create"),
  tripId: z.string().uuid(),
  ticketType: TicketTypeEnum.optional(),
  title: z.string().min(1).max(300),
  vendor: z.string().max(200).optional(),
  referenceCode: z.string().max(500).optional(),
  passengerName: z.string().max(200).optional(),
  validFrom: z.string().datetime().nullable().optional(),
  validUntil: z.string().datetime().nullable().optional(),
  notes: z.string().max(1000).optional(),
});

const UpdateTicketSchema = z.object({
  action: z.literal("update"),
  ticketId: z.string().uuid(),
  ticketType: TicketTypeEnum.optional(),
  title: z.string().min(1).max(300).optional(),
  vendor: z.string().max(200).nullable().optional(),
  referenceCode: z.string().max(500).nullable().optional(),
  passengerName: z.string().max(200).nullable().optional(),
  validFrom: z.string().datetime().nullable().optional(),
  validUntil: z.string().datetime().nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
});

const DeleteTicketSchema = z.object({
  action: z.literal("delete"),
  ticketId: z.string().uuid(),
});

const MutationSchema = z.discriminatedUnion("action", [
  CreateTicketSchema,
  UpdateTicketSchema,
  DeleteTicketSchema,
]);

const QuerySchema = z.object({
  tripId: z.string().uuid(),
});

// ─── GET ─────────────────────────────────────────────────────────────────────

/**
 * GET /api/liff/tickets?tripId=...
 *
 * Returns all tickets for the trip ordered by valid_from (nulls last).
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const result = QuerySchema.safeParse({ tripId: searchParams.get("tripId") });

  if (!result.success) {
    return NextResponse.json<ApiError>(
      { error: "tripId is required", code: "VALIDATION_ERROR" },
      { status: 400 }
    );
  }

  const { tripId } = result.data;
  const membership = await requireTripMembership(req, tripId);
  if (!membership.ok) return membership.response;

  const db = createAdminClient();

  const { data: tickets, error } = await db
    .from("trip_tickets")
    .select("*")
    .eq("trip_id", tripId)
    .order("valid_from", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json<ApiError>(
      { error: "Failed to load tickets", code: "DB_ERROR" },
      { status: 500 }
    );
  }

  return NextResponse.json((tickets ?? []) as TripTicket[]);
}

// ─── POST ─────────────────────────────────────────────────────────────────────

/**
 * POST /api/liff/tickets
 *
 * Unified mutation endpoint.
 * create — any trip member can add a ticket.
 * update — ticket owner or organizer only.
 * delete — ticket owner or organizer only.
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

  const parsed = MutationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json<ApiError>(
      { error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const data = parsed.data;
  const db = createAdminClient();

  switch (data.action) {
    case "create": {
      const membership = await requireTripMembership(req, data.tripId);
      if (!membership.ok) return membership.response;

      const { data: trip } = await db
        .from("trips")
        .select("id, group_id")
        .eq("id", data.tripId)
        .in("status", ["draft", "active"])
        .single();

      if (!trip) {
        return NextResponse.json<ApiError>(
          { error: "Active trip not found", code: "NOT_FOUND" },
          { status: 404 }
        );
      }

      const { data: ticket, error } = await db
        .from("trip_tickets")
        .insert({
          trip_id: data.tripId,
          group_id: trip.group_id,
          added_by_line_user_id: membership.lineUserId,
          ticket_type: data.ticketType ?? "other",
          title: data.title,
          vendor: data.vendor ?? null,
          reference_code: data.referenceCode ?? null,
          passenger_name: data.passengerName ?? null,
          valid_from: data.validFrom ?? null,
          valid_until: data.validUntil ?? null,
          notes: data.notes ?? null,
        })
        .select("*")
        .single();

      if (error || !ticket) {
        return NextResponse.json<ApiError>(
          { error: "Failed to create ticket", code: "DB_ERROR" },
          { status: 500 }
        );
      }
      return NextResponse.json(ticket as TripTicket, { status: 201 });
    }

    case "update": {
      const existing = await fetchTicketWithAuth(req, data.ticketId, db);
      if ("response" in existing) return existing.response;

      const patch: Record<string, unknown> = {};
      if (data.ticketType !== undefined) patch.ticket_type = data.ticketType as TicketType;
      if (data.title !== undefined) patch.title = data.title;
      if (data.vendor !== undefined) patch.vendor = data.vendor;
      if (data.referenceCode !== undefined) patch.reference_code = data.referenceCode;
      if (data.passengerName !== undefined) patch.passenger_name = data.passengerName;
      if (data.validFrom !== undefined) patch.valid_from = data.validFrom;
      if (data.validUntil !== undefined) patch.valid_until = data.validUntil;
      if (data.notes !== undefined) patch.notes = data.notes;

      const { data: ticket, error } = await db
        .from("trip_tickets")
        .update(patch)
        .eq("id", data.ticketId)
        .select("*")
        .single();

      if (error || !ticket) {
        return NextResponse.json<ApiError>(
          { error: "Failed to update ticket", code: "DB_ERROR" },
          { status: 500 }
        );
      }
      return NextResponse.json(ticket as TripTicket);
    }

    case "delete": {
      const existing = await fetchTicketWithAuth(req, data.ticketId, db);
      if ("response" in existing) return existing.response;

      const { error } = await db.from("trip_tickets").delete().eq("id", data.ticketId);
      if (error) {
        return NextResponse.json<ApiError>(
          { error: "Failed to delete ticket", code: "DB_ERROR" },
          { status: 500 }
        );
      }
      return new NextResponse(null, { status: 204 });
    }
  }
}

// ─── Helper ───────────────────────────────────────────────────────────────────

type SupabaseClient = ReturnType<typeof createAdminClient>;

/**
 * Fetch a ticket and verify the caller is the owner or a group organizer.
 * Returns the ticket row on success, or { response } on auth/not-found failure.
 */
async function fetchTicketWithAuth(
  req: NextRequest,
  ticketId: string,
  db: SupabaseClient
): Promise<
  | { id: string; trip_id: string; group_id: string; added_by_line_user_id: string }
  | { response: NextResponse }
> {
  const { data: ticket } = await db
    .from("trip_tickets")
    .select("id, trip_id, group_id, added_by_line_user_id")
    .eq("id", ticketId)
    .single();

  if (!ticket) {
    return {
      response: NextResponse.json<ApiError>(
        { error: "Ticket not found", code: "NOT_FOUND" },
        { status: 404 }
      ),
    };
  }

  // Check if the caller is organizer (can always edit/delete)
  const orgCheck = await requireOrganizerForTrip(req, ticket.trip_id);
  if (orgCheck.ok) return ticket;

  // Fall back: allow the ticket owner
  const memberCheck = await requireTripMembership(req, ticket.trip_id);
  if (!memberCheck.ok) return { response: memberCheck.response };

  if (memberCheck.lineUserId !== ticket.added_by_line_user_id) {
    return {
      response: NextResponse.json<ApiError>(
        { error: "Only the ticket owner or an organizer can modify this ticket", code: "FORBIDDEN" },
        { status: 403 }
      ),
    };
  }

  return ticket;
}

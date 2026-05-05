import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/db";
import { requireAppTripAccess } from "@/lib/app-server";

type RouteContext = { params: Promise<{ tripId: string }> };

export type DayNoteEntry = {
  note: string;
  updatedBy: string;
  updatedByName: string | null;
  updatedAt: string;
};

export type DayNotesMap = Record<string, DayNoteEntry>;

const PatchSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().max(280).nullable(),
});

/**
 * PATCH /api/app/trips/:tripId/day-notes
 *
 * Set or clear a one-line note for a single day of the trip. Notes are stored
 * on `trips.day_notes` as a jsonb map keyed by ISO date so we can fetch all
 * notes alongside the itinerary in one query.
 *
 * Any group member can write a day note (collaborative editing). The latest
 * writer's display name is captured for "last updated by" attribution.
 */
export async function PATCH(
  req: NextRequest,
  ctx: RouteContext
): Promise<NextResponse> {
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

  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Validation failed",
        code: "VALIDATION_ERROR",
        details: parsed.error.flatten(),
      },
      { status: 400 }
    );
  }

  const db = createAdminClient();

  const { data: trip, error: tripErr } = await db
    .from("trips")
    .select("day_notes")
    .eq("id", tripId)
    .single();
  if (tripErr || !trip) {
    return NextResponse.json(
      { error: "Trip not found", code: "NOT_FOUND" },
      { status: 404 }
    );
  }

  const { data: member } = await db
    .from("group_members")
    .select("display_name")
    .eq("group_id", auth.groupId)
    .eq("line_user_id", auth.lineUserId)
    .is("left_at", null)
    .single();
  const displayName = (member?.display_name as string | null) ?? null;

  const current =
    (trip.day_notes as Record<string, unknown> | null) ?? {};
  const next: Record<string, unknown> = { ...current };
  const trimmed = parsed.data.note?.trim() ?? null;
  if (!trimmed) {
    delete next[parsed.data.date];
  } else {
    next[parsed.data.date] = {
      note: trimmed,
      updatedBy: auth.lineUserId,
      updatedByName: displayName,
      updatedAt: new Date().toISOString(),
    };
  }

  const { data: updated, error: updErr } = await db
    .from("trips")
    .update({ day_notes: next })
    .eq("id", tripId)
    .select("day_notes")
    .single();

  if (updErr || !updated) {
    return NextResponse.json(
      { error: "Failed to save note", code: "DB_ERROR" },
      { status: 500 }
    );
  }

  return NextResponse.json<{ dayNotes: DayNotesMap }>({
    dayNotes: (updated.day_notes as DayNotesMap | null) ?? {},
  });
}

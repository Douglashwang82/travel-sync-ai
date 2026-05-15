import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/db";
import { requireAppTripAccessAllowGroupless } from "@/lib/app-server";

type RouteContext = { params: Promise<{ tripId: string }> };

export type AvailabilityStatus = "free" | "maybe" | "busy";

export interface AvailabilityMark {
  lineUserId: string;
  date: string; // YYYY-MM-DD
  status: AvailabilityStatus;
  note: string | null;
}

export interface AvailabilityResponse {
  marks: AvailabilityMark[];
  currentUser: { lineUserId: string };
}

const DateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * GET /api/app/trips/:tripId/availability?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Returns every member's availability marks within the (optional) window so
 * the calendar tile can heatmap who's free per day.
 */
export async function GET(
  req: NextRequest,
  ctx: RouteContext
): Promise<NextResponse> {
  const { tripId } = await ctx.params;
  const auth = await requireAppTripAccessAllowGroupless(req, tripId);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  const db = createAdminClient();
  let query = db
    .from("trip_availability")
    .select("line_user_id, date, status, note")
    .eq("trip_id", tripId);
  if (from && DateString.safeParse(from).success) query = query.gte("date", from);
  if (to && DateString.safeParse(to).success) query = query.lte("date", to);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json(
      { error: "Failed to load availability", code: "DB_ERROR" },
      { status: 500 }
    );
  }

  const marks: AvailabilityMark[] = (data ?? []).map((row) => ({
    lineUserId: row.line_user_id as string,
    date: row.date as string,
    status: row.status as AvailabilityStatus,
    note: (row.note as string | null) ?? null,
  }));

  return NextResponse.json<AvailabilityResponse>({
    marks,
    currentUser: { lineUserId: auth.lineUserId },
  });
}

const StatusEnum = z.enum(["free", "maybe", "busy"]);

const PatchSchema = z.union([
  // Single-day mark. status: null clears the mark.
  z.object({
    date: DateString,
    status: StatusEnum.nullable(),
    note: z.string().max(280).nullable().optional(),
  }),
  // Range mark (inclusive). status: null clears every mark in the range.
  z.object({
    range: z.object({ from: DateString, to: DateString }),
    status: StatusEnum.nullable(),
  }),
]);

/**
 * PATCH /api/app/trips/:tripId/availability
 *
 * Users may only write their own marks; line_user_id is taken from the
 * authenticated session, never from the body.
 */
export async function PATCH(
  req: NextRequest,
  ctx: RouteContext
): Promise<NextResponse> {
  const { tripId } = await ctx.params;
  const auth = await requireAppTripAccessAllowGroupless(req, tripId);
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

  if ("range" in parsed.data) {
    const { from, to } = parsed.data.range;
    if (from > to) {
      return NextResponse.json(
        { error: "from must be <= to", code: "VALIDATION_ERROR" },
        { status: 400 }
      );
    }
    if (parsed.data.status === null) {
      const { error } = await db
        .from("trip_availability")
        .delete()
        .eq("trip_id", tripId)
        .eq("line_user_id", auth.lineUserId)
        .gte("date", from)
        .lte("date", to);
      if (error) return dbError();
    } else {
      const dates = enumerateDates(from, to);
      const rows = dates.map((d) => ({
        trip_id: tripId,
        line_user_id: auth.lineUserId,
        date: d,
        status: parsed.data.status,
        note: null,
        updated_at: new Date().toISOString(),
      }));
      const { error } = await db
        .from("trip_availability")
        .upsert(rows, { onConflict: "trip_id,line_user_id,date" });
      if (error) return dbError();
    }
  } else {
    const { date, status } = parsed.data;
    if (status === null) {
      const { error } = await db
        .from("trip_availability")
        .delete()
        .eq("trip_id", tripId)
        .eq("line_user_id", auth.lineUserId)
        .eq("date", date);
      if (error) return dbError();
    } else {
      const { error } = await db.from("trip_availability").upsert(
        {
          trip_id: tripId,
          line_user_id: auth.lineUserId,
          date,
          status,
          note: parsed.data.note?.trim() || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "trip_id,line_user_id,date" }
      );
      if (error) return dbError();
    }
  }

  return NextResponse.json({ ok: true });
}

function dbError() {
  return NextResponse.json(
    { error: "Failed to save availability", code: "DB_ERROR" },
    { status: 500 }
  );
}

function enumerateDates(from: string, to: string): string[] {
  const out: string[] = [];
  const cur = new Date(from + "T00:00:00Z");
  const end = new Date(to + "T00:00:00Z");
  while (cur <= end) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

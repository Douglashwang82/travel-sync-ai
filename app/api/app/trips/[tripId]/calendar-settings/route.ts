import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/db";
import { requireAppTripAccess } from "@/lib/app-server";

type RouteContext = { params: Promise<{ tripId: string }> };

export interface CalendarSettings {
  countryCodes: string[];
}

/**
 * Per-(trip, user) calendar tile preferences. The country list is personal:
 * each member may pick which countries' holidays they want to see overlaid on
 * the trip's calendar without affecting other members.
 */
export async function GET(
  req: NextRequest,
  ctx: RouteContext
): Promise<NextResponse> {
  const { tripId } = await ctx.params;
  const auth = await requireAppTripAccess(req, tripId);
  if (!auth.ok) return auth.response;

  const db = createAdminClient();
  const { data } = await db
    .from("trip_calendar_settings")
    .select("country_codes")
    .eq("trip_id", tripId)
    .eq("line_user_id", auth.lineUserId)
    .maybeSingle();

  const countryCodes = ((data?.country_codes as string[] | null) ?? []).map((c) =>
    String(c).toUpperCase()
  );
  return NextResponse.json<CalendarSettings>({ countryCodes });
}

const PatchSchema = z.object({
  countryCodes: z.array(z.string().regex(/^[A-Za-z]{2}$/)).max(20),
});

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

  // Normalize, dedupe.
  const codes = Array.from(
    new Set(parsed.data.countryCodes.map((c) => c.toUpperCase()))
  );

  const db = createAdminClient();
  const { error } = await db.from("trip_calendar_settings").upsert(
    {
      trip_id: tripId,
      line_user_id: auth.lineUserId,
      country_codes: codes,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "trip_id,line_user_id" }
  );

  if (error) {
    return NextResponse.json(
      { error: "Failed to save settings", code: "DB_ERROR" },
      { status: 500 }
    );
  }

  return NextResponse.json<CalendarSettings>({ countryCodes: codes });
}

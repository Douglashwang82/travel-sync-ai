import { NextRequest, NextResponse } from "next/server";
import { requireAppTripAccess } from "@/lib/app-server";
import {
  getAvailableCountries,
  getHolidaysInRange,
  type Holiday,
  type NagerCountry,
} from "@/lib/holidays";

type RouteContext = { params: Promise<{ tripId: string }> };

export interface HolidaysResponse {
  holidays: Holiday[];
}

export interface AvailableCountriesResponse {
  countries: NagerCountry[];
}

const COUNTRY_RE = /^[A-Z]{2}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /api/app/trips/:tripId/holidays?countries=TW,JP&from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Or with ?list=countries to return the picker's options instead of holidays.
 */
export async function GET(
  req: NextRequest,
  ctx: RouteContext
): Promise<NextResponse> {
  const { tripId } = await ctx.params;
  const auth = await requireAppTripAccess(req, tripId);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(req.url);

  if (searchParams.get("list") === "countries") {
    const countries = await getAvailableCountries();
    return NextResponse.json<AvailableCountriesResponse>({ countries });
  }

  const raw = (searchParams.get("countries") ?? "")
    .split(",")
    .map((c) => c.trim().toUpperCase())
    .filter((c) => COUNTRY_RE.test(c));
  const countries = Array.from(new Set(raw));

  const from = searchParams.get("from") ?? "";
  const to = searchParams.get("to") ?? "";
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
    return NextResponse.json(
      { error: "from and to (YYYY-MM-DD) are required", code: "VALIDATION_ERROR" },
      { status: 400 }
    );
  }
  if (from > to) {
    return NextResponse.json(
      { error: "from must be <= to", code: "VALIDATION_ERROR" },
      { status: 400 }
    );
  }

  if (countries.length === 0) {
    return NextResponse.json<HolidaysResponse>({ holidays: [] });
  }

  const holidays = await getHolidaysInRange(countries, from, to);
  return NextResponse.json<HolidaysResponse>({ holidays });
}

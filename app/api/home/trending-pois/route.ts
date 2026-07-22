/**
 * GET /api/home/trending-pois?country=jp&city=Tokyo — public trending cards
 * for the index-page POI media wall (no auth; rate-limited per IP).
 *
 * Returns HomePoi-shaped cards synthesized from the social-media trending
 * system (poi_trending_signals + poi_embeddings) for the selected catalog
 * city. Ids are namespaced `trend:<place_id>`; the itinerary and photo routes
 * re-resolve them server-side, so this payload is display-only, never trusted
 * back. An empty `pois` array is the normal cold-destination answer — the
 * wall simply shows the static catalog.
 */

import { NextRequest, NextResponse, after } from "next/server";
import { z } from "zod";
import { checkRateLimit } from "@/lib/rate-limit";
import { getHomeCities, getHomeCountry } from "@/lib/home-survey";
import { getHomeTrendingPois } from "@/services/home-demo/trending-pois";
import { maybeCollectTrendingPois } from "@/services/trending/auto-collect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Query = z.object({
  country: z.enum(["jp", "tw", "us"]),
  city: z.string().min(1).max(80),
});

export async function GET(req: NextRequest): Promise<NextResponse> {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "anon";
  const limit = await checkRateLimit("group", `home-trending:${ip}`);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many requests", code: "RATE_LIMITED" }, { status: 429 });
  }

  const { searchParams } = new URL(req.url);
  const parsed = Query.safeParse({
    country: searchParams.get("country"),
    city: searchParams.get("city"),
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid query", code: "INVALID_QUERY", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const country = getHomeCountry(parsed.data.country);
  const city = getHomeCities(parsed.data.country).find(
    (c) => c.name.toLowerCase() === parsed.data.city.toLowerCase()
  );
  if (!country || !city) {
    return NextResponse.json({ error: "Unknown city", code: "UNKNOWN_CITY" }, { status: 404 });
  }

  const pois = await getHomeTrendingPois(country.code, city.name);

  // Self-heal: if this city's signals are cold or stale, collect in the
  // background after the response is sent. Safe on a public route — the city
  // is catalog-validated (finite universe) and maybeCollectTrendingPois
  // enforces freshness + in-flight + cooldown guards, so cost is bounded to
  // at most one collection per city per freshness window.
  after(() => maybeCollectTrendingPois(`${city.name}, ${country.name}`, city.name));

  return NextResponse.json(
    { pois },
    { headers: { "cache-control": "public, max-age=300, s-maxage=600, stale-while-revalidate=600" } }
  );
}

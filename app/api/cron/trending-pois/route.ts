import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/db";
import { verifyCronRequest } from "@/lib/cron-auth";
import { captureError } from "@/lib/monitoring";
import { getHomeCities, HOME_COUNTRIES } from "@/lib/home-survey";
import { collectTrendingPois, type CollectResult } from "@/services/trending/collector";

/** Max destinations refreshed per run — each costs 2 LLM calls + ≤12 Places lookups. */
const MAX_DESTINATIONS_PER_RUN = 8;

/** Skip destinations whose signals were refreshed within this window. */
const FRESHNESS_WINDOW_MS = 20 * 60 * 60 * 1000; // 20h — daily cron with slack

/** How far back survey sessions count as demand for a destination. */
const SURVEY_LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * GET /api/cron/trending-pois
 *
 * Daily refresh of social-media trending POI signals. Destinations with
 * active demand — an upcoming/active trip or a recent trip survey — plus the
 * landing-page catalog cities (always-eligible seeds) are collected via
 * services/trending/collector.ts (Gemini search grounding → structured
 * extraction → Places resolution) and land in `poi_trending_signals` (+ new
 * places into `poi_embeddings`), where the itinerary generator's POI-picking
 * phase and the index-page POI wall consume them. Cold cities additionally
 * self-heal on demand via services/trending/auto-collect.ts, so no manual
 * collection is ever required.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const authError = verifyCronRequest(req);
  if (authError) return authError;

  const db = createAdminClient();

  let destinations: string[];
  try {
    destinations = await selectDestinations(db);
  } catch (err) {
    captureError(err, { context: "cron_trending_pois_select" });
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  if (destinations.length === 0) return NextResponse.json({ processed: 0 });

  const results: Array<Pick<CollectResult, "destination" | "resolved" | "signalsUpserted"> & { ok: boolean }> = [];
  // Sequential on purpose: each collection is LLM-heavy and shares the Gemini
  // circuit breaker — parallel runs would just trip it under degradation.
  for (const destination of destinations) {
    try {
      const r = await collectTrendingPois(destination);
      results.push({ destination, resolved: r.resolved, signalsUpserted: r.signalsUpserted, ok: true });
    } catch (err) {
      captureError(err, { context: "cron_trending_pois", destination });
      results.push({ destination, resolved: 0, signalsUpserted: 0, ok: false });
    }
  }

  const succeeded = results.filter((r) => r.ok).length;
  console.info(`[cron/trending-pois] processed ${results.length}`, {
    succeeded,
    failed: results.length - succeeded,
    signals: results.reduce((a, r) => a + r.signalsUpserted, 0),
  });
  return NextResponse.json({ processed: results.length, succeeded, results });
}

/**
 * Destinations worth refreshing: upcoming/active trips first, then recent
 * survey sessions, then the landing-page catalog cities (always eligible so
 * the public POI wall stays warm with zero user demand) — deduped
 * case-insensitively, minus destinations whose signals are still fresh,
 * capped at MAX_DESTINATIONS_PER_RUN. The freshness skip makes the list
 * rotate across days, so a low cap still covers every seed eventually.
 */
async function selectDestinations(db: ReturnType<typeof createAdminClient>): Promise<string[]> {
  const today = new Date().toISOString().slice(0, 10);

  const [tripsRes, surveysRes, freshRes] = await Promise.all([
    db
      .from("trips")
      .select("destination_name, start_date, status")
      .in("status", ["draft", "active"])
      .limit(200),
    db
      .from("trip_survey_sessions")
      .select("answers")
      .gte("updated_at", new Date(Date.now() - SURVEY_LOOKBACK_MS).toISOString())
      .limit(200),
    db
      .from("poi_trending_signals")
      .select("destination_name")
      .gte("collected_at", new Date(Date.now() - FRESHNESS_WINDOW_MS).toISOString()),
  ]);
  if (tripsRes.error) throw new Error(`trips lookup failed: ${tripsRes.error.message}`);
  if (surveysRes.error) throw new Error(`survey lookup failed: ${surveysRes.error.message}`);
  if (freshRes.error) throw new Error(`signals lookup failed: ${freshRes.error.message}`);

  const fresh = (freshRes.data ?? []).map((r) => String(r.destination_name).trim().toLowerCase());
  // A destination counts as fresh when any fresh signal row's name contains it
  // or is contained by it, so "Tokyo" demand and the "Tokyo, Japan" seed don't
  // double-collect each other.
  const isFresh = (key: string) => fresh.some((f) => f === key || f.includes(key) || key.includes(f));

  const ordered: string[] = [];
  const seen = new Set<string>();
  const push = (raw: unknown) => {
    if (typeof raw !== "string") return;
    const dest = raw.trim();
    const key = dest.toLowerCase();
    if (!dest || seen.has(key) || isFresh(key)) return;
    seen.add(key);
    ordered.push(dest);
  };

  for (const t of tripsRes.data ?? []) {
    // Past trips still marked active don't need fresh trend data.
    if (t.start_date && t.start_date < today && t.status !== "active") continue;
    push(t.destination_name);
  }
  for (const s of surveysRes.data ?? []) {
    push((s.answers as { destination?: unknown } | null)?.destination);
  }
  // Landing-page catalog cities: always-eligible seeds so the public POI wall
  // is warm without any trips or surveys existing.
  for (const country of HOME_COUNTRIES) {
    for (const city of getHomeCities(country.code)) {
      push(`${city.name}, ${country.name}`);
    }
  }

  return ordered.slice(0, MAX_DESTINATIONS_PER_RUN);
}

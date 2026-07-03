// ─────────────────────────────────────────────────────────────────────────────
// Itinerary benchmark — deterministic quality scoring for generated
// itineraries, so generator changes can be measured instead of eyeballed.
//
// Pure functions, no I/O, no LLM: the same itinerary always gets the same
// score, which makes the score usable both as a CI regression gate
// (__tests__/evals/itinerary.eval.test.ts) and as a longitudinal tracking
// signal (scripts/benchmark-itinerary.ts appends live pipeline scores to
// benchmarks/history.jsonl).
//
// Seven weighted metrics, each 0–1, aggregated to a 0–100 total:
//
//   coverage           every day of the trip has at least one stop
//   pace_fit           stops/day sit inside the pace band (chill/balanced/packed)
//   meal_coverage      each day has a restaurant landing in a meal window
//   travel_efficiency  average inter-stop travel time stays reasonable
//   diversity          no repeated places; days aren't a single item type
//   vibe_alignment     picked stops actually reflect the requested vibes
//   must_haves         free-text must-haves show up in the plan
//
// Adapters at the bottom convert the two shapes an itinerary exists in —
// solver output (RoutedDay[] of EnrichedPoi) and persisted template items —
// into the neutral BenchmarkInput.
// ─────────────────────────────────────────────────────────────────────────────

import type { SurveyAnswers } from "./index";
import type { EnrichedPoi } from "./poi-engine";
import type { RoutedDay } from "./solver";
import { PACE_CAPS } from "./solver";

// ─── Input shape ────────────────────────────────────────────────────────────

export interface BenchmarkStop {
  placeId: string;
  name: string;
  itemType: "hotel" | "restaurant" | "activity" | "transport" | "other";
  tags: string[];
  lat: number | null;
  lng: number | null;
  /** Minutes after midnight, local. */
  arriveMinutes: number;
  departMinutes: number;
}

export interface BenchmarkDay {
  dayNumber: number;
  stops: BenchmarkStop[];
}

export interface BenchmarkInput {
  answers: Pick<
    SurveyAnswers,
    "duration_days" | "pace" | "vibe" | "must_haves" | "party" | "budget_tier"
  >;
  days: BenchmarkDay[];
}

// ─── Report shape ───────────────────────────────────────────────────────────

export type BenchmarkMetricId =
  | "coverage"
  | "pace_fit"
  | "meal_coverage"
  | "travel_efficiency"
  | "diversity"
  | "vibe_alignment"
  | "must_haves";

export interface BenchmarkMetric {
  id: BenchmarkMetricId;
  /** 0–1. */
  score: number;
  weight: number;
  detail: string;
}

export interface BenchmarkReport {
  /** Weighted aggregate, 0–100. */
  total: number;
  metrics: BenchmarkMetric[];
  stats: {
    durationDays: number;
    nonEmptyDays: number;
    totalStops: number;
    restaurants: number;
    avgTravelMinutes: number | null;
  };
}

// ─── Tunables ───────────────────────────────────────────────────────────────

export const METRIC_WEIGHTS: Record<BenchmarkMetricId, number> = {
  coverage: 0.2,
  pace_fit: 0.15,
  meal_coverage: 0.15,
  travel_efficiency: 0.15,
  diversity: 0.1,
  vibe_alignment: 0.15,
  must_haves: 0.1,
};

/** Minimum sensible stops per day, per pace (upper bound is PACE_CAPS). */
const PACE_FLOORS: Record<NonNullable<SurveyAnswers["pace"]>, number> = {
  chill: 2,
  balanced: 3,
  packed: 4,
};

const LUNCH_WINDOW: [number, number] = [12 * 60, 14 * 60];
const DINNER_WINDOW: [number, number] = [18 * 60, 20 * 60];

// Mirrors the solver's travel model (Haversine at a city-average 15 km/h,
// 10-minute floor) so the metric judges the same numbers the solver produced.
const TRAVEL_KMH = 15;
const MIN_TRAVEL_MINUTES = 10;
/** Average inter-stop travel at or below this scores 1. */
const TRAVEL_GOOD_MINUTES = 15;
/** Average inter-stop travel at or above this scores 0. */
const TRAVEL_BAD_MINUTES = 60;

/**
 * Keyword vocabulary for vibe alignment. Matched case-insensitively against
 * each stop's tags, name and item type. Deliberately loose — the metric asks
 * "does the plan lean the right way", not "is every stop on-theme".
 */
const VIBE_KEYWORDS: Record<string, string[]> = {
  relaxed: ["onsen", "spa", "park", "garden", "cafe", "beach", "hot spring", "relax"],
  adventure: ["ski", "snowboard", "hike", "hiking", "climb", "kayak", "surf", "adventure", "backcountry", "rafting"],
  culture: ["temple", "shrine", "museum", "castle", "heritage", "historic", "gallery", "culture", "traditional"],
  foodie: ["restaurant", "food", "market", "izakaya", "ramen", "sushi", "cafe", "bakery", "street food", "dining"],
  nightlife: ["bar", "night", "club", "izakaya", "karaoke", "brewery"],
  nature: ["park", "mountain", "lake", "garden", "nature", "forest", "waterfall", "beach", "trail"],
};

// ─── Scoring ────────────────────────────────────────────────────────────────

export function scoreItinerary(input: BenchmarkInput): BenchmarkReport {
  const durationDays = input.answers.duration_days ?? input.days.length;
  const byDay = new Map(input.days.map((d) => [d.dayNumber, d]));
  const allStops = input.days.flatMap((d) => d.stops);
  const nonEmptyDays = input.days.filter((d) => d.stops.length > 0);

  // An itinerary with no stops at all is worthless — don't let "nothing
  // requested" metrics (vibe, must-haves, travel) hand it neutral credit.
  if (allStops.length === 0) {
    return {
      total: 0,
      metrics: (Object.keys(METRIC_WEIGHTS) as BenchmarkMetricId[]).map((id) =>
        metric(id, 0, "no stops")
      ),
      stats: {
        durationDays,
        nonEmptyDays: 0,
        totalStops: 0,
        restaurants: 0,
        avgTravelMinutes: null,
      },
    };
  }

  const metrics: BenchmarkMetric[] = [
    scoreCoverage(byDay, durationDays),
    scorePaceFit(nonEmptyDays, input.answers.pace),
    scoreMealCoverage(nonEmptyDays),
    scoreTravelEfficiency(input.days),
    scoreDiversity(nonEmptyDays, allStops),
    scoreVibeAlignment(allStops, input.answers.vibe),
    scoreMustHaves(allStops, input.answers.must_haves),
  ];

  const total =
    Math.round(
      metrics.reduce((acc, m) => acc + m.score * METRIC_WEIGHTS[m.id], 0) * 1000
    ) / 10;

  return {
    total,
    metrics,
    stats: {
      durationDays,
      nonEmptyDays: nonEmptyDays.length,
      totalStops: allStops.length,
      restaurants: allStops.filter((s) => s.itemType === "restaurant").length,
      avgTravelMinutes: averageTravelMinutes(input.days),
    },
  };
}

function metric(id: BenchmarkMetricId, score: number, detail: string): BenchmarkMetric {
  return { id, score: clamp01(score), weight: METRIC_WEIGHTS[id], detail };
}

function scoreCoverage(byDay: Map<number, BenchmarkDay>, durationDays: number): BenchmarkMetric {
  if (durationDays <= 0) return metric("coverage", 0, "duration_days is 0");
  const emptyDays: number[] = [];
  for (let d = 1; d <= durationDays; d++) {
    if ((byDay.get(d)?.stops.length ?? 0) === 0) emptyDays.push(d);
  }
  const score = (durationDays - emptyDays.length) / durationDays;
  return metric(
    "coverage",
    score,
    emptyDays.length === 0
      ? `all ${durationDays} days planned`
      : `empty days: ${emptyDays.join(", ")}`
  );
}

function scorePaceFit(
  nonEmptyDays: BenchmarkDay[],
  pace: SurveyAnswers["pace"]
): BenchmarkMetric {
  if (nonEmptyDays.length === 0) return metric("pace_fit", 0, "no planned days");
  const effective = pace ?? "balanced";
  const floor = PACE_FLOORS[effective];
  const cap = PACE_CAPS[effective];
  let sum = 0;
  const offenders: string[] = [];
  for (const day of nonEmptyDays) {
    const n = day.stops.length;
    const distance = n < floor ? floor - n : n > cap ? n - cap : 0;
    // Each stop outside the band costs a third; three off = zero for the day.
    const dayScore = Math.max(0, 1 - distance / 3);
    sum += dayScore;
    if (distance > 0) offenders.push(`D${day.dayNumber}=${n}`);
  }
  return metric(
    "pace_fit",
    sum / nonEmptyDays.length,
    offenders.length === 0
      ? `all days within ${floor}–${cap} stops (${effective})`
      : `outside ${floor}–${cap} (${effective}): ${offenders.join(", ")}`
  );
}

function scoreMealCoverage(nonEmptyDays: BenchmarkDay[]): BenchmarkMetric {
  if (nonEmptyDays.length === 0) return metric("meal_coverage", 0, "no planned days");
  let sum = 0;
  const misses: string[] = [];
  for (const day of nonEmptyDays) {
    const restaurants = day.stops.filter((s) => s.itemType === "restaurant");
    if (restaurants.length === 0) {
      misses.push(`D${day.dayNumber}: no restaurant`);
      continue;
    }
    const anchored = restaurants.some(
      (r) => inWindow(r.arriveMinutes, LUNCH_WINDOW) || inWindow(r.arriveMinutes, DINNER_WINDOW)
    );
    if (anchored) {
      sum += 1;
    } else {
      // A restaurant exists but outside meal windows — half credit.
      sum += 0.5;
      misses.push(`D${day.dayNumber}: restaurant outside meal windows`);
    }
  }
  return metric(
    "meal_coverage",
    sum / nonEmptyDays.length,
    misses.length === 0 ? "every day has a meal-anchored restaurant" : misses.join("; ")
  );
}

function scoreTravelEfficiency(days: BenchmarkDay[]): BenchmarkMetric {
  const avg = averageTravelMinutes(days);
  if (avg == null) {
    return metric("travel_efficiency", 1, "no measurable transitions (single stops or missing coords)");
  }
  const score =
    avg <= TRAVEL_GOOD_MINUTES
      ? 1
      : avg >= TRAVEL_BAD_MINUTES
        ? 0
        : (TRAVEL_BAD_MINUTES - avg) / (TRAVEL_BAD_MINUTES - TRAVEL_GOOD_MINUTES);
  return metric("travel_efficiency", score, `avg inter-stop travel ≈ ${Math.round(avg)} min`);
}

function scoreDiversity(nonEmptyDays: BenchmarkDay[], allStops: BenchmarkStop[]): BenchmarkMetric {
  if (allStops.length === 0) return metric("diversity", 0, "no stops");
  const uniqueness = new Set(allStops.map((s) => s.placeId)).size / allStops.length;

  // Type mix: days with ≥3 stops shouldn't be a single item type.
  const mixDays = nonEmptyDays.filter((d) => d.stops.length >= 3);
  const mixedCount = mixDays.filter(
    (d) => new Set(d.stops.map((s) => s.itemType)).size > 1
  ).length;
  const mix = mixDays.length === 0 ? 1 : mixedCount / mixDays.length;

  const dupes = allStops.length - new Set(allStops.map((s) => s.placeId)).size;
  const details: string[] = [];
  if (dupes > 0) details.push(`${dupes} repeated place(s)`);
  if (mixDays.length > 0 && mixedCount < mixDays.length)
    details.push(`${mixDays.length - mixedCount} single-type day(s)`);
  return metric(
    "diversity",
    0.6 * uniqueness + 0.4 * mix,
    details.length === 0 ? "unique places, mixed day types" : details.join("; ")
  );
}

function scoreVibeAlignment(
  allStops: BenchmarkStop[],
  vibe: SurveyAnswers["vibe"]
): BenchmarkMetric {
  if (!vibe || vibe.length === 0) {
    return metric("vibe_alignment", 1, "no vibe requested (neutral)");
  }
  if (allStops.length === 0) return metric("vibe_alignment", 0, "no stops");
  const keywords = vibe.flatMap((v) => VIBE_KEYWORDS[v] ?? [v]);
  const matched = allStops.filter((s) => stopMatchesAny(s, keywords)).length;
  const fraction = matched / allStops.length;
  // Meals and logistics are structural, so demanding 100% on-theme is wrong;
  // half the stops matching the requested vibes already reads as aligned.
  const score = Math.min(1, fraction / 0.5);
  return metric(
    "vibe_alignment",
    score,
    `${matched}/${allStops.length} stops match ${vibe.join("+")}`
  );
}

function scoreMustHaves(
  allStops: BenchmarkStop[],
  mustHaves: SurveyAnswers["must_haves"]
): BenchmarkMetric {
  const phrases = splitMustHaves(mustHaves);
  if (phrases.length === 0) return metric("must_haves", 1, "none requested");
  if (allStops.length === 0) return metric("must_haves", 0, "no stops");
  const missing = phrases.filter((p) => !allStops.some((s) => stopMatchesAny(s, [p])));
  return metric(
    "must_haves",
    (phrases.length - missing.length) / phrases.length,
    missing.length === 0
      ? `all ${phrases.length} must-have(s) present`
      : `missing: ${missing.join(", ")}`
  );
}

// ─── Adapters ───────────────────────────────────────────────────────────────

/** Score the solver's in-memory output (used by the live pipeline runner). */
export function benchmarkInputFromRoutedDays(
  answers: BenchmarkInput["answers"],
  routedDays: RoutedDay[],
  enriched: EnrichedPoi[]
): BenchmarkInput {
  const byId = new Map(enriched.map((p) => [p.placeId, p]));
  return {
    answers,
    days: routedDays.map((day) => ({
      dayNumber: day.dayNumber,
      stops: day.stops.map((stop) => {
        const poi = byId.get(stop.poi.placeId) ?? stop.poi;
        return {
          placeId: poi.placeId,
          name: poi.name,
          itemType: poi.itemType,
          tags: poi.tags ?? [],
          lat: poi.lat,
          lng: poi.lng,
          arriveMinutes: stop.arriveMinutes,
          departMinutes: stop.departMinutes,
        };
      }),
    })),
  };
}

/** Persisted trip_template_items row — the subset the benchmark needs. */
export interface TemplateItemRow {
  day_number: number;
  order_index: number;
  item_type: string;
  title: string;
  notes: string | null;
  lat: number | null;
  lng: number | null;
  duration_minutes: number | null;
}

const ARRIVAL_NOTE_RE = /預計抵達 (\d{2}):(\d{2})/;

/**
 * Score a persisted template (what the user actually received). Arrival times
 * are recovered from the "預計抵達 HH:MM" note the generator writes; rows
 * without one fall back to a synthetic 9:00-plus-order slot so ordering-based
 * metrics still work, at the cost of meal-window precision.
 */
export function benchmarkInputFromTemplateItems(
  answers: BenchmarkInput["answers"],
  items: TemplateItemRow[]
): BenchmarkInput {
  const dayNumbers = Array.from(new Set(items.map((i) => i.day_number))).sort((a, b) => a - b);
  const days: BenchmarkDay[] = dayNumbers.map((dayNumber) => {
    const rows = items
      .filter((i) => i.day_number === dayNumber)
      .sort((a, b) => a.order_index - b.order_index);
    return {
      dayNumber,
      stops: rows.map((row, idx) => {
        const m = ARRIVAL_NOTE_RE.exec(row.notes ?? "");
        const arrive = m ? Number(m[1]) * 60 + Number(m[2]) : 9 * 60 + idx * 120;
        const duration = row.duration_minutes ?? 60;
        return {
          placeId: `${dayNumber}:${row.order_index}:${row.title}`,
          name: row.title,
          itemType: normalizeItemType(row.item_type),
          tags: [],
          lat: row.lat,
          lng: row.lng,
          arriveMinutes: arrive,
          departMinutes: arrive + duration,
        };
      }),
    };
  });
  return { answers, days };
}

// ─── Report formatting ──────────────────────────────────────────────────────

export function formatBenchmarkReport(report: BenchmarkReport): string {
  const lines = [
    `total: ${report.total.toFixed(1)} / 100`,
    ...report.metrics.map(
      (m) =>
        `  ${m.id.padEnd(18)} ${(m.score * 100).toFixed(0).padStart(3)}  (w=${m.weight})  ${m.detail}`
    ),
    `  stops=${report.stats.totalStops} restaurants=${report.stats.restaurants} ` +
      `days=${report.stats.nonEmptyDays}/${report.stats.durationDays} ` +
      `avgTravel=${report.stats.avgTravelMinutes == null ? "n/a" : `${Math.round(report.stats.avgTravelMinutes)}m`}`,
  ];
  return lines.join("\n");
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function averageTravelMinutes(days: BenchmarkDay[]): number | null {
  let total = 0;
  let transitions = 0;
  for (const day of days) {
    for (let i = 1; i < day.stops.length; i++) {
      const a = day.stops[i - 1];
      const b = day.stops[i];
      if (a.lat == null || a.lng == null || b.lat == null || b.lng == null) continue;
      const km = haversineKm(a.lat, a.lng, b.lat, b.lng);
      total += Math.max(MIN_TRAVEL_MINUTES, Math.round((km / TRAVEL_KMH) * 60));
      transitions++;
    }
  }
  return transitions === 0 ? null : total / transitions;
}

function stopMatchesAny(stop: BenchmarkStop, keywords: string[]): boolean {
  const haystack = [stop.name, stop.itemType, ...stop.tags].join(" ").toLowerCase();
  return keywords.some((k) => haystack.includes(k.toLowerCase()));
}

function splitMustHaves(mustHaves: string | null | undefined): string[] {
  if (!mustHaves) return [];
  return mustHaves
    .split(/[,、;；\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2);
}

function normalizeItemType(raw: string): BenchmarkStop["itemType"] {
  switch (raw) {
    case "hotel":
    case "restaurant":
    case "activity":
    case "transport":
      return raw;
    default:
      return "other";
  }
}

function inWindow(t: number, w: [number, number]): boolean {
  return t >= w[0] && t <= w[1];
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Exposed for tests.
export const __testing = {
  averageTravelMinutes,
  splitMustHaves,
  VIBE_KEYWORDS,
  TRAVEL_GOOD_MINUTES,
  TRAVEL_BAD_MINUTES,
};

// ─────────────────────────────────────────────────────────────────────────────
// Solver — Tier 3 of the v1.2 itinerary generator.
//
// Takes the LLM's day-by-day assignment of EnrichedPoi candidates and:
//   1. Brute-force permutes each day's stops (≤6 stops → 720 permutations,
//      well within budget),
//   2. Simulates arrival/departure times using Haversine + a city-tier
//      travel multiplier,
//   3. Enforces opening-hours and meal-anchor windows,
//   4. Returns either a RoutedItinerary or a structured InfeasibilityReport
//      the orchestrator can feed back to the LLM in its repair loop.
//
// We deliberately avoid OR-Tools / a Python sidecar at this size. If stops/day
// ever exceeds 8 or we add booking-time windows, swap in a CP solver behind
// the same interface.
// ─────────────────────────────────────────────────────────────────────────────

import type { EnrichedPoi } from "./poi-engine";
import type { OpeningHoursPeriod } from "@/services/decisions/places";
import type { SurveyAnswers } from "./index";

export interface SolverInput {
  /** Outer array index = day_number - 1. Inner = LLM-picked POIs for that day. */
  daysAssignment: EnrichedPoi[][];
  pace: SurveyAnswers["pace"];
  /** ISO weekday (0=Sun..6=Sat) for day 1. Used to match opening hours. */
  startWeekday: number;
  /** When stops in a day should start (minutes after midnight, local). */
  dayStartMinutes?: number;
}

export interface RoutedStop {
  poi: EnrichedPoi;
  arriveMinutes: number;
  departMinutes: number;
}

export interface RoutedDay {
  dayNumber: number;
  stops: RoutedStop[];
}

export interface InfeasibilityIssue {
  dayNumber: number;
  reason:
    | "too_many_stops"
    | "no_valid_permutation"
    | "missing_meal_anchor"
    | "no_coords";
  detail: string;
  /** placeIds the orchestrator should consider swapping out. */
  offendingPlaceIds: string[];
}

export type SolverResult =
  | { ok: true; days: RoutedDay[] }
  | { ok: false; issues: InfeasibilityIssue[] };

// ─── Tunables ────────────────────────────────────────────────────────────────

const PACE_CAPS: Record<NonNullable<SurveyAnswers["pace"]>, number> = {
  chill: 3,
  balanced: 5,
  packed: 6,
};

const DEFAULT_STOP_MINUTES: Record<EnrichedPoi["itemType"], number> = {
  activity: 90,
  restaurant: 75,
  hotel: 30,
  transport: 30,
  other: 60,
};

const DAY_START_MINUTES_DEFAULT = 9 * 60; // 09:00
const DAY_END_MINUTES = 22 * 60;          // 22:00

const LUNCH_WINDOW: [number, number] = [12 * 60, 14 * 60];
const DINNER_WINDOW: [number, number] = [18 * 60, 20 * 60];

// Travel speed: rough city-average door-to-door (walking + transit).
// 4 km/h is conservative on purpose — better to leave slack than fail late.
const TRAVEL_KMH = 4;
const MIN_TRAVEL_MINUTES = 10;
const MAX_PERMUTATION_STOPS = 7; // 7! = 5040; above this, fall back to nearest-neighbor.

// ─── Public entry ────────────────────────────────────────────────────────────

export function solveItinerary(input: SolverInput): SolverResult {
  const issues: InfeasibilityIssue[] = [];
  const routedDays: RoutedDay[] = [];

  const cap = PACE_CAPS[input.pace ?? "balanced"];

  for (let d = 0; d < input.daysAssignment.length; d++) {
    const dayNumber = d + 1;
    const stops = input.daysAssignment[d] ?? [];

    if (stops.length === 0) {
      // Empty day — render an empty routed day; not an error.
      routedDays.push({ dayNumber, stops: [] });
      continue;
    }

    if (stops.length > cap) {
      issues.push({
        dayNumber,
        reason: "too_many_stops",
        detail: `${stops.length} stops exceeds pace cap of ${cap}`,
        offendingPlaceIds: stops.slice(cap).map((s) => s.placeId),
      });
      continue;
    }

    const weekday = (input.startWeekday + d) % 7;
    const routed = solveDay({
      stops,
      weekday,
      dayStart: input.dayStartMinutes ?? DAY_START_MINUTES_DEFAULT,
    });

    if (!routed.ok) {
      issues.push({ dayNumber, ...routed.issue });
      continue;
    }
    routedDays.push({ dayNumber, stops: routed.stops });
  }

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, days: routedDays };
}

// ─── Per-day solver ──────────────────────────────────────────────────────────

interface SolveDayInput {
  stops: EnrichedPoi[];
  weekday: number;
  dayStart: number;
}

type DaySolveResult =
  | { ok: true; stops: RoutedStop[] }
  | { ok: false; issue: Omit<InfeasibilityIssue, "dayNumber"> };

function solveDay(input: SolveDayInput): DaySolveResult {
  const { stops } = input;

  const withCoords = stops.filter((s) => s.lat != null && s.lng != null);
  if (withCoords.length < stops.length) {
    return {
      ok: false,
      issue: {
        reason: "no_coords",
        detail: "Some POIs missing lat/lng after enrichment",
        offendingPlaceIds: stops.filter((s) => s.lat == null || s.lng == null).map((s) => s.placeId),
      },
    };
  }

  const permutations =
    stops.length <= MAX_PERMUTATION_STOPS
      ? enumeratePermutations(stops)
      : [nearestNeighborOrder(stops)];

  let best: { route: RoutedStop[]; totalTravel: number } | null = null;

  for (const order of permutations) {
    const sim = simulateOrder(order, input.weekday, input.dayStart);
    if (!sim.feasible) continue;
    if (!best || sim.totalTravel < best.totalTravel) {
      best = { route: sim.route, totalTravel: sim.totalTravel };
    }
  }

  if (!best) {
    return {
      ok: false,
      issue: {
        reason: "no_valid_permutation",
        detail: "No ordering satisfies opening hours and travel windows",
        offendingPlaceIds: stops.map((s) => s.placeId),
      },
    };
  }

  // Meal anchors: if the day has any restaurants, at least one must land in a
  // meal window. (Days with zero restaurants are valid — coffee morning,
  // hiking, etc. — so we don't impose this unconditionally.)
  const restaurants = best.route.filter((r) => r.poi.itemType === "restaurant");
  if (restaurants.length > 0) {
    const hasMealAnchor = restaurants.some(
      (r) => inWindow(r.arriveMinutes, LUNCH_WINDOW) || inWindow(r.arriveMinutes, DINNER_WINDOW)
    );
    if (!hasMealAnchor) {
      return {
        ok: false,
        issue: {
          reason: "missing_meal_anchor",
          detail: "No restaurant lands inside the lunch (12–14) or dinner (18–20) window",
          offendingPlaceIds: restaurants.map((r) => r.poi.placeId),
        },
      };
    }
  }

  return { ok: true, stops: best.route };
}

// ─── Simulation ──────────────────────────────────────────────────────────────

function simulateOrder(
  order: EnrichedPoi[],
  weekday: number,
  dayStart: number
): { feasible: boolean; route: RoutedStop[]; totalTravel: number } {
  const route: RoutedStop[] = [];
  let cursor = dayStart;
  let totalTravel = 0;
  let prev: EnrichedPoi | null = null;

  for (const poi of order) {
    if (prev) {
      const travel = travelMinutesBetween(prev, poi);
      cursor += travel;
      totalTravel += travel;
    }

    const openWindows = openingWindowsFor(poi, weekday);
    if (openWindows.length > 0) {
      const window = openWindows.find((w) => w[1] > cursor) ?? null;
      if (!window) return { feasible: false, route: [], totalTravel: 0 };
      cursor = Math.max(cursor, window[0]);
    }

    const stay = DEFAULT_STOP_MINUTES[poi.itemType];
    const arrive = cursor;
    const depart = cursor + stay;

    if (depart > DAY_END_MINUTES) return { feasible: false, route: [], totalTravel: 0 };
    if (openWindows.length > 0) {
      const within = openWindows.some((w) => arrive >= w[0] && depart <= w[1]);
      if (!within) return { feasible: false, route: [], totalTravel: 0 };
    }

    route.push({ poi, arriveMinutes: arrive, departMinutes: depart });
    cursor = depart;
    prev = poi;
  }

  return { feasible: true, route, totalTravel };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function openingWindowsFor(poi: EnrichedPoi, weekday: number): Array<[number, number]> {
  const periods = poi.live?.openingPeriods ?? [];
  if (periods.length === 0) return [];
  const windows: Array<[number, number]> = [];
  for (const p of periods) {
    if (p.openDay !== weekday) continue;
    // Wrap-past-midnight (e.g. bars closing at 02:00) — clip to day end so a
    // late-night stop doesn't get scheduled past 22:00 anyway.
    const close = p.closeDay === weekday ? p.closeMinutes : 24 * 60;
    windows.push([p.openMinutes, close]);
  }
  return windows;
}

function travelMinutesBetween(a: EnrichedPoi, b: EnrichedPoi): number {
  const km = haversineKm(a.lat!, a.lng!, b.lat!, b.lng!);
  return Math.max(MIN_TRAVEL_MINUTES, Math.round((km / TRAVEL_KMH) * 60));
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

function enumeratePermutations<T>(arr: T[]): T[][] {
  if (arr.length <= 1) return [arr.slice()];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i++) {
    const rest = arr.slice(0, i).concat(arr.slice(i + 1));
    for (const sub of enumeratePermutations(rest)) {
      out.push([arr[i], ...sub]);
    }
  }
  return out;
}

function nearestNeighborOrder(stops: EnrichedPoi[]): EnrichedPoi[] {
  if (stops.length === 0) return [];
  const remaining = stops.slice();
  const order: EnrichedPoi[] = [remaining.shift()!];
  while (remaining.length > 0) {
    const last = order[order.length - 1];
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = haversineKm(last.lat!, last.lng!, remaining[i].lat!, remaining[i].lng!);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    order.push(remaining.splice(bestIdx, 1)[0]);
  }
  return order;
}

function inWindow(t: number, w: [number, number]): boolean {
  return t >= w[0] && t <= w[1];
}

// Exposed for tests.
export const __testing = {
  haversineKm,
  enumeratePermutations,
  openingWindowsFor,
  simulateOrder,
  PACE_CAPS,
  LUNCH_WINDOW,
  DINNER_WINDOW,
};

// Avoid unused-export complaint for OpeningHoursPeriod re-import.
export type { OpeningHoursPeriod };

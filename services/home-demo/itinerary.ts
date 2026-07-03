// ─────────────────────────────────────────────────────────────────────────────
// Home-demo itinerary builder — the deterministic spine of the index-page
// survey pipeline (POST /api/home/itinerary).
//
// The public demo reuses the real Tier-3 solver (services/trip-generation/
// solver.ts) for time-window simulation, but everything else here is pure and
// dependency-free so the endpoint can never strand an anonymous visitor:
//
//   cluster  — greedy geographic clustering of the visitor's POIs into days
//   plan     — (route layer) optional LLM day-assignment, validated against
//              the catalog; falls back to the clusters below
//   solve    — solveItinerary() with pace "balanced"; per-day fallback
//              scheduler (nearest-neighbor + meal-anchor insertion) when the
//              solver reports infeasibility
//   cost     — per-stop USD estimates from the catalog, formatted into the
//              destination currency
//
// No DB, no network: callers inject the catalog rows from lib/home-survey.
// ─────────────────────────────────────────────────────────────────────────────

import { solveItinerary, type RoutedDay } from "@/services/trip-generation/solver";
import type { EnrichedPoi } from "@/services/trip-generation/poi-engine";
import type {
  HomeCountry,
  HomeItinerary,
  HomeItineraryDay,
  HomeItineraryStop,
  HomePoi,
} from "@/lib/home-survey";

export const MAX_STOPS_PER_DAY = 4;

const DAY_START_MINUTES = 9 * 60; // 09:00
const DAY_END_MINUTES = 22 * 60; // 22:00
const TRAVEL_KMH = 15;
const MIN_TRAVEL_MINUTES = 10;
const LUNCH_TARGET_MINUTES = 12 * 60 + 30; // aim restaurants at 12:30

// ─── Geometry ────────────────────────────────────────────────────────────────

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function travelMinutes(km: number): number {
  return Math.max(MIN_TRAVEL_MINUTES, Math.round((km / TRAVEL_KMH) * 60));
}

// ─── Clustering: POIs → days ─────────────────────────────────────────────────

/**
 * Greedy geographic clustering: repeatedly seed a day with the POI farthest
 * from every already-clustered POI, then pull in its nearest unclustered
 * neighbors up to `maxPerDay`. Keeps each day walkable/transit-sized even
 * when the selection spans several cities (Tokyo + Kyoto, NYC + LA, …).
 *
 * `targetDays` (the visitor's picked trip length) is honored when feasible:
 * it is clamped to [ceil(n / maxPerDay), n], the fill size shrinks so no day
 * hogs stops another day needs, and oversized days are split until the count
 * matches — so a 6-day window with 8 picks yields six lighter days, not two
 * packed ones.
 */
export function clusterPoisIntoDays(pois: HomePoi[], maxPerDay = MAX_STOPS_PER_DAY, targetDays?: number): HomePoi[][] {
  if (pois.length === 0) return [];
  const target =
    targetDays == null
      ? null
      : Math.min(Math.max(targetDays, Math.ceil(pois.length / maxPerDay)), pois.length);
  if (target != null) maxPerDay = Math.min(maxPerDay, Math.ceil(pois.length / target));
  const remaining = [...pois];
  const clusters: HomePoi[][] = [];

  while (remaining.length > 0) {
    let seedIdx = 0;
    if (clusters.length > 0) {
      // Farthest-point seeding: the POI with the greatest distance to its
      // nearest already-clustered POI starts the next day.
      let bestScore = -1;
      for (let i = 0; i < remaining.length; i++) {
        let nearest = Infinity;
        for (const cluster of clusters) {
          for (const placed of cluster) {
            const d = haversineKm(remaining[i].lat, remaining[i].lng, placed.lat, placed.lng);
            if (d < nearest) nearest = d;
          }
        }
        if (nearest > bestScore) {
          bestScore = nearest;
          seedIdx = i;
        }
      }
    }

    const seed = remaining.splice(seedIdx, 1)[0];
    const day = [seed];
    while (day.length < maxPerDay && remaining.length > 0) {
      let bestIdx = 0;
      let bestDist = Infinity;
      for (let i = 0; i < remaining.length; i++) {
        const d = haversineKm(seed.lat, seed.lng, remaining[i].lat, remaining[i].lng);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      }
      day.push(remaining.splice(bestIdx, 1)[0]);
    }
    clusters.push(day);
  }

  // Split the largest days until the visitor's day count is reached: peel off
  // the stop farthest from its day's centroid into a day of its own.
  if (target != null) {
    while (clusters.length < target) {
      let splitIdx = -1;
      let splitSize = 1;
      for (let i = 0; i < clusters.length; i++) {
        if (clusters[i].length > splitSize) {
          splitSize = clusters[i].length;
          splitIdx = i;
        }
      }
      if (splitIdx === -1) break;
      const cluster = clusters[splitIdx];
      const centroidLat = cluster.reduce((s, p) => s + p.lat, 0) / cluster.length;
      const centroidLng = cluster.reduce((s, p) => s + p.lng, 0) / cluster.length;
      let farIdx = 0;
      let farDist = -1;
      for (let i = 0; i < cluster.length; i++) {
        const d = haversineKm(cluster[i].lat, cluster[i].lng, centroidLat, centroidLng);
        if (d > farDist) {
          farDist = d;
          farIdx = i;
        }
      }
      clusters[splitIdx] = cluster.filter((_, i) => i !== farIdx);
      clusters.push([cluster[farIdx]]);
    }
  }

  return orderClustersByProximity(clusters);
}

/** Chain clusters so consecutive days are geographic neighbors. */
function orderClustersByProximity(clusters: HomePoi[][]): HomePoi[][] {
  if (clusters.length <= 2) return clusters;
  const centroids = clusters.map((c) => ({
    lat: c.reduce((s, p) => s + p.lat, 0) / c.length,
    lng: c.reduce((s, p) => s + p.lng, 0) / c.length,
  }));
  const ordered: HomePoi[][] = [clusters[0]];
  const used = new Set([0]);
  let current = 0;
  while (ordered.length < clusters.length) {
    let bestIdx = -1;
    let bestDist = Infinity;
    for (let i = 0; i < clusters.length; i++) {
      if (used.has(i)) continue;
      const d = haversineKm(centroids[current].lat, centroids[current].lng, centroids[i].lat, centroids[i].lng);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    used.add(bestIdx);
    ordered.push(clusters[bestIdx]);
    current = bestIdx;
  }
  return ordered;
}

/**
 * Check an LLM day-assignment: every selected POI exactly once, no inventions,
 * day sizes within cap. Returns the resolved clusters or null when invalid.
 */
export function resolveAssignment(
  daysPoiIds: string[][],
  selected: HomePoi[],
  maxPerDay = MAX_STOPS_PER_DAY,
): HomePoi[][] | null {
  const byId = new Map(selected.map((p) => [p.id, p]));
  const seen = new Set<string>();
  const days: HomePoi[][] = [];
  for (const ids of daysPoiIds) {
    if (ids.length === 0 || ids.length > maxPerDay) return null;
    const day: HomePoi[] = [];
    for (const id of ids) {
      const poi = byId.get(id);
      if (!poi || seen.has(id)) return null;
      seen.add(id);
      day.push(poi);
    }
    days.push(day);
  }
  if (seen.size !== selected.length) return null;
  return days;
}

// ─── Scheduling: days → timed stops ──────────────────────────────────────────

export interface ScheduledStop {
  poi: HomePoi;
  arriveMinutes: number;
  departMinutes: number;
}

export interface ScheduledDay {
  stops: ScheduledStop[];
  travelKm: number;
}

/**
 * Run the production solver first (real opening-hours/meal-window semantics),
 * then patch any infeasible day with the deterministic fallback so the demo
 * always produces a complete plan.
 */
export function scheduleDays(
  days: HomePoi[][],
  startWeekday: number,
): { days: ScheduledDay[]; usedSolver: boolean } {
  const assignment = days.map((day) => day.map(toEnrichedPoi));
  const result = solveItinerary({
    daysAssignment: assignment,
    pace: "balanced",
    startWeekday,
    dayStartMinutes: DAY_START_MINUTES,
  });

  if (result.ok) {
    return { days: result.days.map((d, i) => fromRoutedDay(d, days[i])), usedSolver: true };
  }
  return { days: days.map((day) => fallbackScheduleDay(day)), usedSolver: false };
}

function toEnrichedPoi(poi: HomePoi): EnrichedPoi {
  return {
    placeId: poi.id,
    name: poi.name,
    itemType: poi.itemType,
    tags: [],
    description: poi.blurb,
    lat: poi.lat,
    lng: poi.lng,
    similarity: 1,
    source: "home_catalog",
    live: null,
  };
}

function fromRoutedDay(routed: RoutedDay, pois: HomePoi[]): ScheduledDay {
  const byId = new Map(pois.map((p) => [p.id, p]));
  const stops: ScheduledStop[] = routed.stops.map((s) => ({
    poi: byId.get(s.poi.placeId)!,
    arriveMinutes: s.arriveMinutes,
    departMinutes: s.departMinutes,
  }));
  return { stops, travelKm: pathKm(stops.map((s) => s.poi)) };
}

/**
 * Fallback scheduler: nearest-neighbor walking order, restaurants re-inserted
 * at the position whose simulated arrival lands closest to 12:30, stays from
 * the catalog, day clamped to 09:00–22:00 by compressing overlong stays.
 */
export function fallbackScheduleDay(pois: HomePoi[], dayStart = DAY_START_MINUTES): ScheduledDay {
  if (pois.length === 0) return { stops: [], travelKm: 0 };

  const restaurants = pois.filter((p) => p.itemType === "restaurant");
  const rest = nearestNeighborOrder(pois.filter((p) => p.itemType !== "restaurant"));

  let order = rest;
  for (const r of restaurants) {
    let bestOrder: HomePoi[] | null = null;
    let bestScore = Infinity;
    for (let i = 0; i <= order.length; i++) {
      const candidate = [...order.slice(0, i), r, ...order.slice(i)];
      const sim = simulate(candidate, dayStart);
      const stop = sim.stops.find((s) => s.poi.id === r.id)!;
      const score = Math.abs(stop.arriveMinutes - LUNCH_TARGET_MINUTES);
      if (score < bestScore) {
        bestScore = score;
        bestOrder = candidate;
      }
    }
    order = bestOrder ?? [...order, r];
  }

  return simulate(order, dayStart);
}

function simulate(order: HomePoi[], dayStart: number): ScheduledDay {
  const stops: ScheduledStop[] = [];
  let cursor = dayStart;
  let prev: HomePoi | null = null;
  let travelKm = 0;

  for (const poi of order) {
    if (prev) {
      const km = haversineKm(prev.lat, prev.lng, poi.lat, poi.lng);
      travelKm += km;
      cursor += travelMinutes(km);
    }
    const remaining = DAY_END_MINUTES - cursor;
    const stay = Math.max(30, Math.min(poi.stayMinutes, remaining));
    stops.push({ poi, arriveMinutes: cursor, departMinutes: cursor + stay });
    cursor += stay;
    prev = poi;
  }
  return { stops, travelKm };
}

function nearestNeighborOrder(pois: HomePoi[]): HomePoi[] {
  if (pois.length === 0) return [];
  const remaining = [...pois];
  const order = [remaining.shift()!];
  while (remaining.length > 0) {
    const last = order[order.length - 1];
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = haversineKm(last.lat, last.lng, remaining[i].lat, remaining[i].lng);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    order.push(remaining.splice(bestIdx, 1)[0]);
  }
  return order;
}

function pathKm(pois: HomePoi[]): number {
  let km = 0;
  for (let i = 1; i < pois.length; i++) {
    km += haversineKm(pois[i - 1].lat, pois[i - 1].lng, pois[i].lat, pois[i].lng);
  }
  return km;
}

// ─── Assembly: scheduled days → HomeItinerary ────────────────────────────────

export interface BuildItineraryInput {
  country: HomeCountry;
  scheduled: ScheduledDay[];
  /** ISO date for day 1. */
  startDate: string;
  title: string;
  summary: string;
  themes: string[];
  locale: "en" | "zh-TW";
}

export function buildHomeItinerary(input: BuildItineraryInput): HomeItinerary {
  const days: HomeItineraryDay[] = input.scheduled.map((day, i) => {
    const stops: HomeItineraryStop[] = day.stops.map((s) => ({
      poiId: s.poi.id,
      name: s.poi.name,
      nameZh: s.poi.nameZh,
      city: s.poi.city,
      itemType: s.poi.itemType,
      emoji: s.poi.emoji,
      lat: s.poi.lat,
      lng: s.poi.lng,
      arrive: formatMinutes(s.arriveMinutes),
      depart: formatMinutes(s.departMinutes),
      costUsd: s.poi.costUsd,
      costLocal: formatLocalCost(s.poi.costUsd, input.country),
    }));
    const dayCostUsd = day.stops.reduce((sum, s) => sum + s.poi.costUsd, 0);
    return {
      dayNumber: i + 1,
      date: addDays(input.startDate, i),
      theme: input.themes[i] ?? defaultTheme(day, input.locale),
      stops,
      dayCostUsd,
      travelKm: Math.round(day.travelKm * 10) / 10,
    };
  });

  const totalCostUsd = days.reduce((sum, d) => sum + d.dayCostUsd, 0);
  return {
    title: input.title,
    summary: input.summary,
    country: input.country.code,
    currencyCode: input.country.currency.code,
    days,
    totalCostUsd,
    totalCostLocal: formatLocalCost(totalCostUsd, input.country),
  };
}

export function defaultTheme(day: ScheduledDay, locale: "en" | "zh-TW"): string {
  const cities = [...new Set(day.stops.map((s) => s.poi.city))];
  const label = cities.join(" · ");
  return locale === "zh-TW" ? `${label} 漫遊` : `Exploring ${label}`;
}

export function defaultTitle(country: HomeCountry, dayCount: number, locale: "en" | "zh-TW"): string {
  return locale === "zh-TW"
    ? `${country.nameZh}精選 ${dayCount} 日行程`
    : `${dayCount} days of ${country.name} highlights`;
}

export function defaultSummary(country: HomeCountry, poiCount: number, locale: "en" | "zh-TW"): string {
  return locale === "zh-TW"
    ? `根據你挑選的 ${poiCount} 個地點，AI 規劃了一份按地理位置分群、含交通時間與預估花費的行程。`
    : `Built from the ${poiCount} spots you picked: geographically clustered days with realistic timing and estimated costs across ${country.name}.`;
}

// ─── Formatting helpers ──────────────────────────────────────────────────────

export function formatMinutes(total: number): string {
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function formatLocalCost(usd: number, country: HomeCountry): string {
  const { symbol, perUsd, round } = country.currency;
  if (usd === 0) return locale0(symbol);
  const raw = usd * perUsd;
  const rounded = Math.max(round, Math.round(raw / round) * round);
  return `${symbol}${rounded.toLocaleString("en-US")}`;
}

function locale0(symbol: string): string {
  return `${symbol}0`;
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function weekdayOf(isoDate: string): number {
  return new Date(`${isoDate}T00:00:00Z`).getUTCDay();
}

/** Default departure: the Saturday at least two weeks out. */
export function defaultStartDate(now = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + 14);
  while (d.getUTCDay() !== 6) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// ─────────────────────────────────────────────────────────────────────────────
// Route Synthesizer — cold-start the route_templates corpus from POIs.
//
// Pure logic: given a destination's POIs (each with lat/lng and item_type),
// emit candidate multi-stop 1-day routes that are:
//   • geographically coherent (POIs within a small radius of each other),
//   • pace-appropriate (chill 2–3, balanced 3–5, packed 5–6 stops),
//   • meal-anchored when long enough (interleave activities + restaurants),
//   • deduped (no two routes with the same set of place_ids).
//
// This module is intentionally DB-free and LLM-free. The CLI wrapper in
// scripts/synthesize-routes.ts handles loading POIs, calling Gemini for
// titles/summaries, and persisting to route_templates / seed JSON files.
//
// Algorithm:
//   1. Drop POIs without lat/lng or that are hotels/transport (day routes
//      shouldn't anchor on accommodations).
//   2. Greedy-cluster the rest by Haversine distance (default 1.5 km).
//   3. For each cluster, produce a small set of routes per pace by walking
//      a slot-plan (A=activity, R=restaurant) and rotating which POI fills
//      each slot. Skip clusters with too few activities/restaurants.
// ─────────────────────────────────────────────────────────────────────────────

import type { PoiCandidate } from "./poi-engine";

export type Pace = "chill" | "balanced" | "packed";

export interface SynthPoi {
  placeId: string;
  name: string;
  itemType: PoiCandidate["itemType"];
  tags: string[];
  description: string;
  lat: number;
  lng: number;
}

export interface PoiCluster {
  centroidLat: number;
  centroidLng: number;
  pois: SynthPoi[];
}

export interface SynthesizedRoute {
  pace: Pace;
  placeIds: string[];
  pois: SynthPoi[];
  vibeTags: string[];
  pinnedVibes: string[];
  centroidLat: number;
  centroidLng: number;
}

export const SYNTH_TUNABLES = {
  CLUSTER_RADIUS_KM: 1.5,
  PACE_STOP_COUNTS: { chill: 3, balanced: 5, packed: 6 } as const,
  MIN_STOPS_PER_ROUTE: 2,
  MAX_ROUTES_PER_CLUSTER_PER_PACE: 2,
  MAX_VIBE_TAGS: 5,
  PIN_MIN_FREQUENCY: 2,
} as const;

// ─── Geo helpers ─────────────────────────────────────────────────────────────

export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// ─── Clustering ──────────────────────────────────────────────────────────────

/**
 * Greedy geographic clustering. Iterates POIs in (lat, lng) order and assigns
 * each to its nearest existing cluster within `radiusKm`, otherwise seeds a
 * new cluster. Centroid is a running mean — good enough for the small
 * neighborhood-scale buckets we're aiming for (~1.5 km).
 */
export function clusterPoisByDistance(
  pois: SynthPoi[],
  radiusKm: number = SYNTH_TUNABLES.CLUSTER_RADIUS_KM
): PoiCluster[] {
  const clusters: PoiCluster[] = [];
  const sorted = pois
    .slice()
    .sort((a, b) => a.lat - b.lat || a.lng - b.lng || a.placeId.localeCompare(b.placeId));

  for (const poi of sorted) {
    let bestIdx = -1;
    let bestDist = Infinity;
    for (let i = 0; i < clusters.length; i++) {
      const d = haversineKm(
        { lat: clusters[i].centroidLat, lng: clusters[i].centroidLng },
        poi
      );
      if (d <= radiusKm && d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    if (bestIdx === -1) {
      clusters.push({ centroidLat: poi.lat, centroidLng: poi.lng, pois: [poi] });
    } else {
      const c = clusters[bestIdx];
      c.pois.push(poi);
      const n = c.pois.length;
      c.centroidLat += (poi.lat - c.centroidLat) / n;
      c.centroidLng += (poi.lng - c.centroidLng) / n;
    }
  }
  return clusters;
}

// ─── Composition ─────────────────────────────────────────────────────────────

/**
 * Map pace → slot plan. Activities anchor the head + tail of the day; meal
 * restaurants slot into positions that roughly correspond to lunch/dinner
 * once the solver assigns absolute times. The packed plan front-loads a
 * second activity so the day starts before the lunch anchor.
 */
function buildSlotPlan(target: number): Array<"A" | "R"> {
  switch (target) {
    case 1: return ["A"];
    case 2: return ["A", "R"];
    case 3: return ["A", "R", "A"];
    case 4: return ["A", "R", "A", "R"];
    case 5: return ["A", "R", "A", "R", "A"];
    case 6: return ["A", "A", "R", "A", "R", "A"];
    default:
      return Array.from({ length: target }, (_, i) => (i % 2 === 0 ? "A" : "R"));
  }
}

/** Trim a slot plan to fit the available POI counts, preserving order. */
function trimSlotPlan(
  plan: Array<"A" | "R">,
  maxA: number,
  maxR: number
): Array<"A" | "R"> {
  const out: Array<"A" | "R"> = [];
  let usedA = 0;
  let usedR = 0;
  for (const s of plan) {
    if (s === "A" && usedA < maxA) {
      out.push(s);
      usedA++;
    } else if (s === "R" && usedR < maxR) {
      out.push(s);
      usedR++;
    }
  }
  return out;
}

function buildOneRoute(
  plan: Array<"A" | "R">,
  activities: SynthPoi[],
  restaurants: SynthPoi[],
  aStart: number,
  rStart: number,
  pace: Pace,
  cluster: PoiCluster
): SynthesizedRoute | null {
  const stops: SynthPoi[] = [];
  const used = new Set<string>();
  let aIdx = aStart;
  let rIdx = rStart;

  for (const s of plan) {
    const pool = s === "A" ? activities : restaurants;
    if (pool.length === 0) continue;
    let picked: SynthPoi | null = null;
    for (let i = 0; i < pool.length; i++) {
      const idx = s === "A" ? (aIdx + i) % pool.length : (rIdx + i) % pool.length;
      const cand = pool[idx];
      if (!used.has(cand.placeId)) {
        picked = cand;
        if (s === "A") aIdx = (idx + 1) % pool.length;
        else rIdx = (idx + 1) % pool.length;
        break;
      }
    }
    if (picked) {
      stops.push(picked);
      used.add(picked.placeId);
    }
  }

  if (stops.length < SYNTH_TUNABLES.MIN_STOPS_PER_ROUTE) return null;

  const tagCounts = new Map<string, number>();
  for (const stop of stops) {
    for (const tag of stop.tags) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
  }
  const sortedTags = [...tagCounts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
  );
  const vibeTags = sortedTags
    .slice(0, SYNTH_TUNABLES.MAX_VIBE_TAGS)
    .map(([t]) => t);
  const pinnedVibes =
    sortedTags.length > 0 && sortedTags[0][1] >= SYNTH_TUNABLES.PIN_MIN_FREQUENCY
      ? [sortedTags[0][0]]
      : [];

  return {
    pace,
    placeIds: stops.map((s) => s.placeId),
    pois: stops,
    vibeTags,
    pinnedVibes,
    centroidLat: cluster.centroidLat,
    centroidLng: cluster.centroidLng,
  };
}

function signature(route: SynthesizedRoute): string {
  return route.placeIds.slice().sort().join("|");
}

/**
 * Generate routes from a single cluster across requested paces. Skips paces
 * for which the cluster can't produce the minimum stop count.
 */
export function composeRoutesFromCluster(
  cluster: PoiCluster,
  opts: { paces?: Pace[] } = {}
): SynthesizedRoute[] {
  const paces = opts.paces ?? (["chill", "balanced", "packed"] as Pace[]);
  const activities = cluster.pois.filter((p) => p.itemType === "activity");
  const restaurants = cluster.pois.filter((p) => p.itemType === "restaurant");

  if (activities.length === 0) return [];

  const out: SynthesizedRoute[] = [];
  const seenSignatures = new Set<string>();

  for (const pace of paces) {
    const target = SYNTH_TUNABLES.PACE_STOP_COUNTS[pace];
    const slotPlan = buildSlotPlan(target);
    const wantA = slotPlan.filter((s) => s === "A").length;
    const wantR = slotPlan.filter((s) => s === "R").length;
    const trimmed = trimSlotPlan(
      slotPlan,
      Math.min(wantA, activities.length),
      Math.min(wantR, restaurants.length)
    );
    if (trimmed.length < SYNTH_TUNABLES.MIN_STOPS_PER_ROUTE) continue;

    for (let offset = 0; offset < SYNTH_TUNABLES.MAX_ROUTES_PER_CLUSTER_PER_PACE; offset++) {
      const aStart = offset % Math.max(1, activities.length);
      const rStart = offset % Math.max(1, restaurants.length);
      const route = buildOneRoute(
        trimmed,
        activities,
        restaurants,
        aStart,
        rStart,
        pace,
        cluster
      );
      if (!route) break;
      const sig = signature(route);
      if (seenSignatures.has(sig)) continue;
      seenSignatures.add(sig);
      out.push(route);
    }
  }
  return out;
}

/**
 * Convenience: end-to-end synthesis from a raw POI list. Filters out POIs
 * lacking lat/lng or whose item_type doesn't belong in a day-trip plan.
 */
export function synthesizeRoutes(
  pois: PoiCandidate[],
  opts: { paces?: Pace[]; clusterRadiusKm?: number } = {}
): SynthesizedRoute[] {
  const usable: SynthPoi[] = [];
  for (const p of pois) {
    if (p.lat == null || p.lng == null) continue;
    if (p.itemType !== "activity" && p.itemType !== "restaurant") continue;
    usable.push({
      placeId: p.placeId,
      name: p.name,
      itemType: p.itemType,
      tags: p.tags,
      description: p.description,
      lat: p.lat,
      lng: p.lng,
    });
  }
  const clusters = clusterPoisByDistance(
    usable,
    opts.clusterRadiusKm ?? SYNTH_TUNABLES.CLUSTER_RADIUS_KM
  );
  const routes: SynthesizedRoute[] = [];
  for (const c of clusters) {
    routes.push(...composeRoutesFromCluster(c, { paces: opts.paces }));
  }
  return routes;
}

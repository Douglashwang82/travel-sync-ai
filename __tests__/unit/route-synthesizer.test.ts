import { describe, it, expect } from "vitest";
import {
  haversineKm,
  clusterPoisByDistance,
  composeRoutesFromCluster,
  synthesizeRoutes,
  SYNTH_TUNABLES,
  type SynthPoi,
} from "@/services/trip-generation/route-synthesizer";
import type { PoiCandidate } from "@/services/trip-generation/poi-engine";

function poi(opts: Partial<SynthPoi> & { placeId: string; lat: number; lng: number }): SynthPoi {
  return {
    placeId: opts.placeId,
    name: opts.name ?? opts.placeId,
    itemType: opts.itemType ?? "activity",
    tags: opts.tags ?? [],
    description: opts.description ?? "",
    lat: opts.lat,
    lng: opts.lng,
  };
}

describe("haversineKm", () => {
  it("returns 0 for the same point", () => {
    expect(haversineKm({ lat: 36.92, lng: 138.44 }, { lat: 36.92, lng: 138.44 })).toBeCloseTo(0, 5);
  });

  it("approximates known distance Nozawa→Hakuba (~80 km)", () => {
    const nozawa = { lat: 36.9229, lng: 138.4421 };
    const hakuba = { lat: 36.7, lng: 137.86 };
    const d = haversineKm(nozawa, hakuba);
    expect(d).toBeGreaterThan(50);
    expect(d).toBeLessThan(80);
  });
});

describe("clusterPoisByDistance", () => {
  it("groups POIs that fall within radius into one cluster", () => {
    // Six POIs jammed into Nozawa onsen village (~300m across).
    const pois = [
      poi({ placeId: "a", lat: 36.9229, lng: 138.4421 }),
      poi({ placeId: "b", lat: 36.9234, lng: 138.4413 }),
      poi({ placeId: "c", lat: 36.9243, lng: 138.4416 }),
      poi({ placeId: "d", lat: 36.9226, lng: 138.4428 }),
    ];
    const clusters = clusterPoisByDistance(pois, 1.5);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].pois).toHaveLength(4);
  });

  it("separates POIs farther apart than radius into distinct clusters", () => {
    const pois = [
      poi({ placeId: "nozawa", lat: 36.9229, lng: 138.4421 }),
      poi({ placeId: "hakuba", lat: 36.7, lng: 137.86 }),
    ];
    const clusters = clusterPoisByDistance(pois, 1.5);
    expect(clusters).toHaveLength(2);
  });

  it("is stable: equivalent input order yields equivalent clusters", () => {
    const a = [
      poi({ placeId: "a", lat: 36.9229, lng: 138.4421 }),
      poi({ placeId: "b", lat: 36.9234, lng: 138.4413 }),
    ];
    const b = a.slice().reverse();
    expect(clusterPoisByDistance(a, 1.5)).toEqual(clusterPoisByDistance(b, 1.5));
  });
});

describe("composeRoutesFromCluster", () => {
  it("returns no routes when the cluster has no activities", () => {
    const cluster = {
      centroidLat: 0,
      centroidLng: 0,
      pois: [
        poi({ placeId: "r1", lat: 0, lng: 0, itemType: "restaurant" }),
        poi({ placeId: "r2", lat: 0, lng: 0, itemType: "restaurant" }),
      ],
    };
    expect(composeRoutesFromCluster(cluster)).toEqual([]);
  });

  it("interleaves activities and restaurants and respects pace caps", () => {
    const cluster = {
      centroidLat: 0,
      centroidLng: 0,
      pois: [
        poi({ placeId: "a1", lat: 0, lng: 0, itemType: "activity", tags: ["onsen"] }),
        poi({ placeId: "a2", lat: 0, lng: 0, itemType: "activity", tags: ["onsen"] }),
        poi({ placeId: "a3", lat: 0, lng: 0, itemType: "activity", tags: ["cultural"] }),
        poi({ placeId: "r1", lat: 0, lng: 0, itemType: "restaurant", tags: ["foodie"] }),
        poi({ placeId: "r2", lat: 0, lng: 0, itemType: "restaurant", tags: ["foodie"] }),
      ],
    };
    const routes = composeRoutesFromCluster(cluster, { paces: ["balanced"] });
    expect(routes.length).toBeGreaterThan(0);
    for (const r of routes) {
      expect(r.placeIds.length).toBeLessThanOrEqual(SYNTH_TUNABLES.PACE_STOP_COUNTS.balanced);
      expect(r.placeIds.length).toBeGreaterThanOrEqual(SYNTH_TUNABLES.MIN_STOPS_PER_ROUTE);
      // No duplicate stops within a route
      expect(new Set(r.placeIds).size).toBe(r.placeIds.length);
    }
  });

  it("produces a route with one restaurant for chill pace when stops allow", () => {
    const cluster = {
      centroidLat: 0,
      centroidLng: 0,
      pois: [
        poi({ placeId: "a1", lat: 0, lng: 0, itemType: "activity" }),
        poi({ placeId: "a2", lat: 0, lng: 0, itemType: "activity" }),
        poi({ placeId: "r1", lat: 0, lng: 0, itemType: "restaurant" }),
      ],
    };
    const routes = composeRoutesFromCluster(cluster, { paces: ["chill"] });
    expect(routes.length).toBeGreaterThan(0);
    const r = routes[0];
    expect(r.pace).toBe("chill");
    // Chill plan is [A, R, A] — should produce all three when POIs allow.
    expect(r.placeIds).toHaveLength(3);
    expect(r.pois.filter((p) => p.itemType === "restaurant")).toHaveLength(1);
  });

  it("derives vibe_tags from POI tag frequency and pins the most common", () => {
    const cluster = {
      centroidLat: 0,
      centroidLng: 0,
      pois: [
        poi({ placeId: "a1", lat: 0, lng: 0, itemType: "activity", tags: ["onsen", "relaxed"] }),
        poi({ placeId: "a2", lat: 0, lng: 0, itemType: "activity", tags: ["onsen"] }),
        poi({ placeId: "r1", lat: 0, lng: 0, itemType: "restaurant", tags: ["foodie", "onsen"] }),
      ],
    };
    const routes = composeRoutesFromCluster(cluster, { paces: ["chill"] });
    expect(routes[0].vibeTags).toContain("onsen");
    expect(routes[0].pinnedVibes).toEqual(["onsen"]);
  });

  it("deduplicates routes with the same place_id set across paces", () => {
    // Tiny cluster: 1 activity + 1 restaurant. Every pace lands on the same pair.
    const cluster = {
      centroidLat: 0,
      centroidLng: 0,
      pois: [
        poi({ placeId: "a1", lat: 0, lng: 0, itemType: "activity" }),
        poi({ placeId: "r1", lat: 0, lng: 0, itemType: "restaurant" }),
      ],
    };
    const routes = composeRoutesFromCluster(cluster, {
      paces: ["chill", "balanced", "packed"],
    });
    const sigs = new Set(routes.map((r) => r.placeIds.slice().sort().join("|")));
    expect(sigs.size).toBe(routes.length);
  });
});

describe("synthesizeRoutes (end-to-end)", () => {
  it("filters out hotels/transport and POIs without coordinates", () => {
    const pois: PoiCandidate[] = [
      { placeId: "a1", name: "Onsen", itemType: "activity", tags: [], description: "", lat: 36.92, lng: 138.44, similarity: 1 },
      { placeId: "r1", name: "Soba", itemType: "restaurant", tags: [], description: "", lat: 36.92, lng: 138.44, similarity: 1 },
      { placeId: "h1", name: "Ryokan", itemType: "hotel", tags: [], description: "", lat: 36.92, lng: 138.44, similarity: 1 },
      { placeId: "t1", name: "Station", itemType: "transport", tags: [], description: "", lat: 36.92, lng: 138.44, similarity: 1 },
      { placeId: "x1", name: "Lost", itemType: "activity", tags: [], description: "", lat: null, lng: null, similarity: 1 },
    ];
    const routes = synthesizeRoutes(pois);
    const allIds = new Set(routes.flatMap((r) => r.placeIds));
    expect(allIds.has("h1")).toBe(false);
    expect(allIds.has("t1")).toBe(false);
    expect(allIds.has("x1")).toBe(false);
  });

  it("returns at least one route for a viable cluster", () => {
    const pois: PoiCandidate[] = [
      { placeId: "a1", name: "Oyu", itemType: "activity", tags: ["onsen"], description: "", lat: 36.9229, lng: 138.4421, similarity: 1 },
      { placeId: "a2", name: "Shinyu", itemType: "activity", tags: ["onsen"], description: "", lat: 36.9234, lng: 138.4413, similarity: 1 },
      { placeId: "r1", name: "Soba", itemType: "restaurant", tags: ["foodie"], description: "", lat: 36.9226, lng: 138.4428, similarity: 1 },
    ];
    const routes = synthesizeRoutes(pois);
    expect(routes.length).toBeGreaterThan(0);
    expect(routes[0].placeIds.length).toBeGreaterThanOrEqual(2);
  });
});

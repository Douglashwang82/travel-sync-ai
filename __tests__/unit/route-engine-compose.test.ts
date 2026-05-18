import { describe, it, expect } from "vitest";
import { composeFromRoutes, ROUTE_TUNABLES } from "@/services/trip-generation/route-engine";
import type { RouteCandidate } from "@/services/trip-generation/route-engine";

function route(opts: Partial<RouteCandidate> & { routeId: string; placeIds: string[] }): RouteCandidate {
  return {
    routeId: opts.routeId,
    title: opts.title ?? opts.routeId,
    summary: opts.summary ?? "",
    vibeTags: opts.vibeTags ?? [],
    pace: opts.pace ?? "balanced",
    placeIds: opts.placeIds,
    similarity: opts.similarity ?? 0.8,
    boost: opts.boost ?? 0,
    qualityScore: opts.qualityScore ?? 0,
    pinnedVibes: opts.pinnedVibes ?? [],
    finalScore: opts.finalScore ?? 0.8,
  };
}

describe("composeFromRoutes", () => {
  it("fills every day when routes are plentiful and disjoint", () => {
    const routes = [
      route({ routeId: "r1", placeIds: ["a", "b"], finalScore: 0.9 }),
      route({ routeId: "r2", placeIds: ["c", "d"], finalScore: 0.85 }),
      route({ routeId: "r3", placeIds: ["e", "f"], finalScore: 0.8 }),
    ];
    const out = composeFromRoutes(routes, 3);
    expect(out.coveredDays.size).toBe(3);
    expect(out.uncoveredDays).toEqual([]);
    expect(out.usedPlaceIds.size).toBe(6);
  });

  it("skips routes that collide on place_ids and lists the day as uncovered", () => {
    // r2 collides with r1 on "b" — only r1 should be picked, day 2 left uncovered.
    const routes = [
      route({ routeId: "r1", placeIds: ["a", "b"], finalScore: 0.9 }),
      route({ routeId: "r2", placeIds: ["b", "c"], finalScore: 0.85 }),
    ];
    const out = composeFromRoutes(routes, 2);
    expect(out.coveredDays.get(1)?.routeId).toBe("r1");
    expect(out.coveredDays.has(2)).toBe(false);
    expect(out.uncoveredDays).toEqual([2]);
  });

  it("never reuses the same route across days", () => {
    const routes = [route({ routeId: "r1", placeIds: ["a", "b"], finalScore: 0.9 })];
    const out = composeFromRoutes(routes, 3);
    expect(out.coveredDays.size).toBe(1);
    expect(out.uncoveredDays).toEqual([2, 3]);
  });

  it("returns all days uncovered when no routes are supplied", () => {
    const out = composeFromRoutes([], 4);
    expect(out.coveredDays.size).toBe(0);
    expect(out.uncoveredDays).toEqual([1, 2, 3, 4]);
    expect(out.usedPlaceIds.size).toBe(0);
  });

  it("respects input order — earlier routes win for earlier days", () => {
    // Caller is expected to sort by finalScore desc before composing.
    const routes = [
      route({ routeId: "high", placeIds: ["a"], finalScore: 0.95 }),
      route({ routeId: "low", placeIds: ["b"], finalScore: 0.73 }),
    ];
    const out = composeFromRoutes(routes, 2);
    expect(out.coveredDays.get(1)?.routeId).toBe("high");
    expect(out.coveredDays.get(2)?.routeId).toBe("low");
  });
});

describe("ROUTE_TUNABLES", () => {
  it("gate is above raw similarity floor so a 0.5 fallback can't slip through", () => {
    // The POI engine emits a 0.5 sentinel for live-text fallback candidates.
    // The route gate must be strictly above that to keep tiers distinct.
    expect(ROUTE_TUNABLES.GATE).toBeGreaterThan(0.5);
  });

  it("pin bonus is small enough to not single-handedly clear the gate", () => {
    // A pinned route with 0 similarity and 0 boost shouldn't pass on pin alone.
    expect(ROUTE_TUNABLES.PIN_BONUS).toBeLessThan(ROUTE_TUNABLES.GATE);
  });
});

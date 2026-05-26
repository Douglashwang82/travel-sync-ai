import { describe, it, expect } from "vitest";
import { solveItinerary, __testing } from "@/services/trip-generation/solver";
import type { EnrichedPoi } from "@/services/trip-generation/poi-engine";

function poi(opts: Partial<EnrichedPoi> & { placeId: string; lat: number; lng: number }): EnrichedPoi {
  return {
    placeId: opts.placeId,
    name: opts.name ?? opts.placeId,
    itemType: opts.itemType ?? "activity",
    tags: [],
    description: "",
    lat: opts.lat,
    lng: opts.lng,
    similarity: 1,
    live: opts.live ?? { placeId: opts.placeId, name: null, address: null, rating: null, priceLevel: null, lat: opts.lat, lng: opts.lng, openingPeriods: [] },
  };
}

describe("solver — pace cap", () => {
  it("rejects a day that exceeds the pace cap", () => {
    const stops = Array.from({ length: 5 }, (_, i) =>
      poi({ placeId: `p${i}`, lat: 35 + i * 0.001, lng: 139 + i * 0.001 })
    );
    const r = solveItinerary({
      daysAssignment: [stops],
      pace: "chill", // cap = 3
      startWeekday: 1,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues[0].reason).toBe("too_many_stops");
      expect(r.issues[0].offendingPlaceIds.length).toBeGreaterThan(0);
    }
  });
});

describe("solver — coords required", () => {
  it("flags POIs missing lat/lng", () => {
    const a = poi({ placeId: "a", lat: 35.0, lng: 139.0 });
    const b = poi({ placeId: "b", lat: 35.01, lng: 139.01 });
    (b as { lat: number | null }).lat = null;
    const r = solveItinerary({ daysAssignment: [[a, b]], pace: "balanced", startWeekday: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0].reason).toBe("no_coords");
  });
});

describe("solver — opening hours", () => {
  it("schedules within open windows when feasible", () => {
    // Tuesday (weekday=2). A opens 10:00–12:00; B opens 13:00–17:00.
    const a = poi({
      placeId: "a",
      lat: 35.0,
      lng: 139.0,
      live: {
        placeId: "a",
        name: null,
        address: null,
        rating: null,
        priceLevel: null,
        lat: 35.0,
        lng: 139.0,
        openingPeriods: [{ openDay: 2, openMinutes: 10 * 60, closeDay: 2, closeMinutes: 12 * 60 }],
      },
    });
    const b = poi({
      placeId: "b",
      lat: 35.005,
      lng: 139.005,
      live: {
        placeId: "b",
        name: null,
        address: null,
        rating: null,
        priceLevel: null,
        lat: 35.005,
        lng: 139.005,
        openingPeriods: [{ openDay: 2, openMinutes: 13 * 60, closeDay: 2, closeMinutes: 17 * 60 }],
      },
    });
    const r = solveItinerary({ daysAssignment: [[a, b]], pace: "balanced", startWeekday: 2 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.days[0].stops).toHaveLength(2);
      expect(r.days[0].stops[0].poi.placeId).toBe("a");
      expect(r.days[0].stops[0].arriveMinutes).toBeGreaterThanOrEqual(10 * 60);
      expect(r.days[0].stops[1].arriveMinutes).toBeGreaterThanOrEqual(13 * 60);
    }
  });

  it("reports infeasibility when no permutation fits", () => {
    // Both stops open 09:00–10:00 only. Can't visit both within their window.
    const window = [{ openDay: 1, openMinutes: 9 * 60, closeDay: 1, closeMinutes: 10 * 60 }];
    const a = poi({
      placeId: "a",
      lat: 35.0,
      lng: 139.0,
      live: { placeId: "a", name: null, address: null, rating: null, priceLevel: null, lat: 35.0, lng: 139.0, openingPeriods: window },
    });
    const b = poi({
      placeId: "b",
      lat: 35.1,
      lng: 139.1,
      live: { placeId: "b", name: null, address: null, rating: null, priceLevel: null, lat: 35.1, lng: 139.1, openingPeriods: window },
    });
    const r = solveItinerary({ daysAssignment: [[a, b]], pace: "balanced", startWeekday: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0].reason).toBe("no_valid_permutation");
  });
});

describe("solver — meal anchors", () => {
  it("requires a restaurant in lunch or dinner window", () => {
    // Restaurant offered at 09:00 with no hours constraint — solver will
    // place it at day start (09:00), missing both meal windows.
    const restaurant = poi({
      placeId: "r",
      lat: 35.0,
      lng: 139.0,
      itemType: "restaurant",
    });
    const r = solveItinerary({
      daysAssignment: [[restaurant]],
      pace: "balanced",
      startWeekday: 1,
      dayStartMinutes: 9 * 60,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0].reason).toBe("missing_meal_anchor");
  });

  it("passes when restaurant lands in lunch window", () => {
    const activity = poi({ placeId: "a", lat: 35.0, lng: 139.0, itemType: "activity" });
    const lunch = poi({ placeId: "r", lat: 35.001, lng: 139.001, itemType: "restaurant" });
    const r = solveItinerary({
      daysAssignment: [[activity, lunch, activity, lunch].slice(0, 2)],
      pace: "balanced",
      startWeekday: 1,
      dayStartMinutes: 11 * 60, // activity (90m) → 12:30 restaurant
    });
    expect(r.ok).toBe(true);
  });
});

describe("solver — preordered days", () => {
  it("respects curator order and does not permute", () => {
    // Wide-open hours; B is closer to start, A is farther. With permutation
    // the solver would prefer [A_or_B that minimizes travel] — but preordered
    // forces the caller's order [A, B] regardless.
    const a = poi({ placeId: "a", lat: 35.0, lng: 139.0 });
    const b = poi({ placeId: "b", lat: 35.05, lng: 139.05 });
    const r = solveItinerary({
      daysAssignment: [[a, b]],
      pace: "balanced",
      startWeekday: 1,
      dayStartMinutes: 9 * 60,
      preorderedDays: [true],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.days[0].stops.map((s) => s.poi.placeId)).toEqual(["a", "b"]);
    }
  });

  it("still flags infeasibility when the curator order violates opening hours", () => {
    // [A then B], but A only opens after B closes — order is forced, so fails.
    const a = poi({
      placeId: "a",
      lat: 35.0,
      lng: 139.0,
      live: {
        placeId: "a",
        name: null,
        address: null,
        rating: null,
        priceLevel: null,
        lat: 35.0,
        lng: 139.0,
        openingPeriods: [{ openDay: 1, openMinutes: 15 * 60, closeDay: 1, closeMinutes: 17 * 60 }],
      },
    });
    const b = poi({
      placeId: "b",
      lat: 35.001,
      lng: 139.001,
      live: {
        placeId: "b",
        name: null,
        address: null,
        rating: null,
        priceLevel: null,
        lat: 35.001,
        lng: 139.001,
        openingPeriods: [{ openDay: 1, openMinutes: 9 * 60, closeDay: 1, closeMinutes: 11 * 60 }],
      },
    });
    const r = solveItinerary({
      daysAssignment: [[a, b]],
      pace: "balanced",
      startWeekday: 1,
      dayStartMinutes: 9 * 60,
      preorderedDays: [true],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0].reason).toBe("no_valid_permutation");
  });
});

describe("solver — meal anchor preferred over min travel", () => {
  it("picks a meal-anchored ordering even when a lower-travel one exists", () => {
    // Setup: three stops on a Tuesday (weekday=2).
    //   - A (activity), opens all day
    //   - B (activity), opens all day
    //   - R (restaurant), opens only 12:00–13:30 on Tuesday
    //
    // With day start at 09:00, the only ordering that satisfies the
    // restaurant's window is [A, B, R] (lands ~12:20). [A, R, B] arrives at
    // R at 10:40 — outside the lunch window. The previous solver picked
    // whichever permutation minimised travel and then asked about meal
    // anchors after; with this fix, meal-anchored orderings are preferred.
    const a = poi({ placeId: "a", lat: 35.0, lng: 139.0 });
    const b = poi({ placeId: "b", lat: 35.0005, lng: 139.0005 });
    const r = poi({
      placeId: "r",
      lat: 35.001,
      lng: 139.001,
      itemType: "restaurant",
      live: {
        placeId: "r",
        name: null,
        address: null,
        rating: null,
        priceLevel: null,
        lat: 35.001,
        lng: 139.001,
        openingPeriods: [{ openDay: 2, openMinutes: 12 * 60, closeDay: 2, closeMinutes: 13 * 60 + 30 }],
      },
    });
    const res = solveItinerary({
      daysAssignment: [[a, b, r]],
      pace: "balanced",
      startWeekday: 2,
      dayStartMinutes: 9 * 60,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      const arrival = res.days[0].stops.find((s) => s.poi.placeId === "r")!.arriveMinutes;
      expect(arrival).toBeGreaterThanOrEqual(12 * 60);
      expect(arrival).toBeLessThan(14 * 60);
    }
  });
});

describe("solver — unknown vs. known-closed hours", () => {
  it("treats POIs whose hours have no match for this weekday as closed", () => {
    // POI is open Monday–Friday but the trip starts on Sunday (weekday 0).
    // Old behaviour: empty match list → treated as 24/7. New behaviour: known
    // hours for OTHER days means we know it's closed here.
    const mondayToFriday = Array.from({ length: 5 }, (_, i) => ({
      openDay: i + 1,
      openMinutes: 9 * 60,
      closeDay: i + 1,
      closeMinutes: 18 * 60,
    }));
    const a = poi({
      placeId: "a",
      lat: 35.0,
      lng: 139.0,
      live: {
        placeId: "a",
        name: null,
        address: null,
        rating: null,
        priceLevel: null,
        lat: 35.0,
        lng: 139.0,
        openingPeriods: mondayToFriday,
      },
    });
    const res = solveItinerary({
      daysAssignment: [[a]],
      pace: "balanced",
      startWeekday: 0, // Sunday
      dayStartMinutes: 9 * 60,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.issues[0].reason).toBe("no_valid_permutation");
  });

  it("still treats fully-empty hours as unknown/unconstrained", () => {
    // No periods at all → we don't know, so don't block.
    const a = poi({ placeId: "a", lat: 35.0, lng: 139.0 });
    const res = solveItinerary({
      daysAssignment: [[a]],
      pace: "balanced",
      startWeekday: 0,
      dayStartMinutes: 9 * 60,
    });
    expect(res.ok).toBe(true);
  });
});

describe("solver — pure helpers", () => {
  it("haversineKm yields ~0 for identical points", () => {
    expect(__testing.haversineKm(35, 139, 35, 139)).toBeCloseTo(0, 5);
  });
  it("haversineKm yields ~111km for 1° latitude", () => {
    expect(__testing.haversineKm(0, 0, 1, 0)).toBeGreaterThan(110);
    expect(__testing.haversineKm(0, 0, 1, 0)).toBeLessThan(112);
  });
  it("enumeratePermutations covers n!", () => {
    expect(__testing.enumeratePermutations([1, 2, 3])).toHaveLength(6);
  });
});

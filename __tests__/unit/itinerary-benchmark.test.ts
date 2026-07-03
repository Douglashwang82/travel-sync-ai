import { describe, it, expect } from "vitest";
import {
  scoreItinerary,
  benchmarkInputFromTemplateItems,
  benchmarkInputFromRoutedDays,
  formatBenchmarkReport,
  __testing,
  type BenchmarkInput,
  type BenchmarkStop,
} from "@/services/trip-generation/benchmark";
import type { EnrichedPoi } from "@/services/trip-generation/poi-engine";
import type { RoutedDay } from "@/services/trip-generation/solver";

function stop(overrides: Partial<BenchmarkStop>): BenchmarkStop {
  return {
    placeId: overrides.placeId ?? `p-${Math.random().toString(36).slice(2, 8)}`,
    name: "Some Place",
    itemType: "activity",
    tags: [],
    lat: 35.68,
    lng: 139.76,
    arriveMinutes: 9 * 60,
    departMinutes: 10 * 60,
    ...overrides,
  };
}

/** 3-stop balanced-ish day with a lunch-anchored restaurant, tight geography. */
function goodDay(dayNumber: number): BenchmarkInput["days"][number] {
  return {
    dayNumber,
    stops: [
      stop({ placeId: `d${dayNumber}-a`, name: "Museum", tags: ["museum", "culture"], lat: 35.68, lng: 139.76, arriveMinutes: 540, departMinutes: 630 }),
      stop({ placeId: `d${dayNumber}-b`, name: "Ramen Shop", itemType: "restaurant", tags: ["ramen"], lat: 35.682, lng: 139.762, arriveMinutes: 750, departMinutes: 825 }),
      stop({ placeId: `d${dayNumber}-c`, name: "City Park", tags: ["park"], lat: 35.684, lng: 139.764, arriveMinutes: 840, departMinutes: 930 }),
    ],
  };
}

function baseInput(overrides?: Partial<BenchmarkInput["answers"]>): BenchmarkInput {
  return {
    answers: { duration_days: 2, pace: "balanced", vibe: [], must_haves: null, ...overrides },
    days: [goodDay(1), goodDay(2)],
  };
}

describe("scoreItinerary", () => {
  it("scores a well-formed itinerary high", () => {
    const report = scoreItinerary(baseInput());
    expect(report.total).toBeGreaterThanOrEqual(85);
    expect(report.stats.totalStops).toBe(6);
    expect(report.stats.nonEmptyDays).toBe(2);
  });

  it("coverage: penalizes missing / empty days", () => {
    const input = baseInput();
    input.days = [goodDay(1)]; // day 2 missing entirely
    const report = scoreItinerary(input);
    const coverage = report.metrics.find((m) => m.id === "coverage")!;
    expect(coverage.score).toBeCloseTo(0.5, 5);
    expect(coverage.detail).toContain("2");
  });

  it("pace_fit: penalizes days outside the pace band", () => {
    const input = baseInput({ pace: "chill" }); // chill band is 2–3
    input.days[0].stops.push(
      stop({ placeId: "extra-1" }),
      stop({ placeId: "extra-2" })
    ); // 5 stops on chill = 2 over cap
    const report = scoreItinerary(input);
    const pace = report.metrics.find((m) => m.id === "pace_fit")!;
    expect(pace.score).toBeLessThan(1);
    expect(pace.detail).toContain("D1=5");
  });

  it("meal_coverage: full credit only for meal-window restaurants", () => {
    const noRestaurant = baseInput();
    noRestaurant.days = [
      { dayNumber: 1, stops: [stop({ placeId: "a" }), stop({ placeId: "b" }), stop({ placeId: "c" })] },
    ];
    noRestaurant.answers.duration_days = 1;
    const r1 = scoreItinerary(noRestaurant);
    expect(r1.metrics.find((m) => m.id === "meal_coverage")!.score).toBe(0);

    const offWindow = baseInput();
    offWindow.answers.duration_days = 1;
    offWindow.days = [
      {
        dayNumber: 1,
        stops: [
          stop({ placeId: "a" }),
          stop({ placeId: "b", itemType: "restaurant", arriveMinutes: 16 * 60, departMinutes: 17 * 60 }),
          stop({ placeId: "c" }),
        ],
      },
    ];
    const r2 = scoreItinerary(offWindow);
    expect(r2.metrics.find((m) => m.id === "meal_coverage")!.score).toBe(0.5);
  });

  it("travel_efficiency: punishes cross-city ping-pong", () => {
    const input = baseInput();
    input.answers.duration_days = 1;
    input.days = [
      {
        dayNumber: 1,
        stops: [
          stop({ placeId: "osaka", lat: 34.6873, lng: 135.5262 }),
          stop({ placeId: "kyoto", lat: 35.0116, lng: 135.7681 }),
          stop({ placeId: "osaka2", lat: 34.6873, lng: 135.5262 }),
        ],
      },
    ];
    const report = scoreItinerary(input);
    expect(report.metrics.find((m) => m.id === "travel_efficiency")!.score).toBe(0);
    expect(report.stats.avgTravelMinutes).toBeGreaterThan(__testing.TRAVEL_BAD_MINUTES);
  });

  it("travel_efficiency: neutral when coords are missing", () => {
    const input = baseInput();
    input.answers.duration_days = 1;
    input.days = [
      {
        dayNumber: 1,
        stops: [
          stop({ placeId: "a", lat: null, lng: null }),
          stop({ placeId: "b", lat: null, lng: null }),
        ],
      },
    ];
    const report = scoreItinerary(input);
    expect(report.metrics.find((m) => m.id === "travel_efficiency")!.score).toBe(1);
    expect(report.stats.avgTravelMinutes).toBeNull();
  });

  it("diversity: penalizes repeated places and single-type days", () => {
    const input = baseInput();
    input.answers.duration_days = 1;
    input.days = [
      {
        dayNumber: 1,
        stops: [
          stop({ placeId: "dup" }),
          stop({ placeId: "dup" }),
          stop({ placeId: "other" }),
        ],
      },
    ];
    const report = scoreItinerary(input);
    const diversity = report.metrics.find((m) => m.id === "diversity")!;
    // uniqueness 2/3, all-activity day fails the mix check
    expect(diversity.score).toBeCloseTo(0.6 * (2 / 3), 5);
  });

  it("vibe_alignment: neutral without vibes, scored with them", () => {
    const neutral = scoreItinerary(baseInput({ vibe: [] }));
    expect(neutral.metrics.find((m) => m.id === "vibe_alignment")!.score).toBe(1);

    const aligned = scoreItinerary(baseInput({ vibe: ["culture", "foodie"] }));
    // Museum (culture) + restaurant (foodie) match on both days: 4/6 ≥ 50%
    expect(aligned.metrics.find((m) => m.id === "vibe_alignment")!.score).toBe(1);

    const misaligned = scoreItinerary(baseInput({ vibe: ["nightlife"] }));
    expect(misaligned.metrics.find((m) => m.id === "vibe_alignment")!.score).toBeLessThan(1);
  });

  it("must_haves: matches phrases against names and tags", () => {
    const hit = scoreItinerary(baseInput({ must_haves: "ramen" }));
    expect(hit.metrics.find((m) => m.id === "must_haves")!.score).toBe(1);

    const miss = scoreItinerary(baseInput({ must_haves: "ramen、teamLab" }));
    const m = miss.metrics.find((x) => x.id === "must_haves")!;
    expect(m.score).toBe(0.5);
    expect(m.detail).toContain("teamLab");
  });

  it("empty itinerary bottoms out without NaN", () => {
    const report = scoreItinerary({ answers: { duration_days: 3, pace: "balanced" }, days: [] });
    expect(Number.isFinite(report.total)).toBe(true);
    expect(report.total).toBeLessThan(40);
  });
});

describe("adapters", () => {
  it("benchmarkInputFromTemplateItems recovers arrival times from notes", () => {
    const input = benchmarkInputFromTemplateItems(
      { duration_days: 1, pace: "balanced" },
      [
        { day_number: 1, order_index: 0, item_type: "activity", title: "Museum", notes: "預計抵達 09:00", lat: 35.68, lng: 139.76, duration_minutes: 90 },
        { day_number: 1, order_index: 1, item_type: "restaurant", title: "Ramen", notes: "預計抵達 12:30", lat: 35.682, lng: 139.762, duration_minutes: 75 },
        { day_number: 1, order_index: 2, item_type: "weird_type", title: "Mystery", notes: null, lat: null, lng: null, duration_minutes: null },
      ]
    );
    expect(input.days).toHaveLength(1);
    const [a, b, c] = input.days[0].stops;
    expect(a.arriveMinutes).toBe(540);
    expect(b.arriveMinutes).toBe(750);
    expect(b.itemType).toBe("restaurant");
    expect(c.itemType).toBe("other");
    expect(c.departMinutes - c.arriveMinutes).toBe(60);
  });

  it("benchmarkInputFromRoutedDays carries poi metadata and solver times", () => {
    const poi: EnrichedPoi = {
      placeId: "p1",
      name: "Meiji Shrine",
      itemType: "activity",
      tags: ["shrine"],
      description: "",
      lat: 35.6764,
      lng: 139.6993,
      similarity: 0.9,
      source: "google_places",
      live: null,
    };
    const routed: RoutedDay[] = [
      { dayNumber: 1, stops: [{ poi, arriveMinutes: 540, departMinutes: 630 }] },
    ];
    const input = benchmarkInputFromRoutedDays({ duration_days: 1, pace: "chill" }, routed, [poi]);
    expect(input.days[0].stops[0]).toMatchObject({
      placeId: "p1",
      name: "Meiji Shrine",
      tags: ["shrine"],
      arriveMinutes: 540,
    });
  });
});

describe("formatBenchmarkReport", () => {
  it("renders a one-screen summary", () => {
    const out = formatBenchmarkReport(scoreItinerary(baseInput()));
    expect(out).toContain("total:");
    expect(out).toContain("meal_coverage");
    expect(out).toContain("stops=6");
  });
});

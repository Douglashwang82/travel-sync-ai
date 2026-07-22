import { describe, it, expect } from "vitest";

import {
  applyTrendingBoost,
  computeTrendScore,
  TREND_BOOST_WEIGHT,
  TREND_HALF_LIFE_DAYS,
  TREND_MAX_AGE_DAYS,
  TRENDING_TAG,
  type TrendingSignal,
} from "@/services/trending/signals";
import type { PoiCandidate } from "@/services/trip-generation/poi-engine";

const NOW = new Date("2026-07-06T00:00:00Z");

function signal(extras: Partial<TrendingSignal> = {}): TrendingSignal {
  return {
    placeId: "p1",
    poiName: "Hot Spot",
    platforms: ["instagram"],
    reason: "viral reel",
    rawScore: 1,
    collectedAt: NOW.toISOString(),
    ...extras,
  };
}

function candidate(id: string, extras: Partial<PoiCandidate> = {}): PoiCandidate {
  return {
    placeId: id,
    name: id,
    itemType: "activity",
    tags: [],
    description: "",
    lat: 35,
    lng: 139,
    similarity: 0.7,
    source: "google_places",
    ...extras,
  };
}

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 86_400_000).toISOString();
}

describe("computeTrendScore — recency decay", () => {
  it("returns the raw score for a signal collected now", () => {
    expect(computeTrendScore(signal(), NOW)).toBeCloseTo(1, 6);
  });

  it("halves the score after one half-life", () => {
    const s = signal({ collectedAt: daysAgo(TREND_HALF_LIFE_DAYS) });
    expect(computeTrendScore(s, NOW)).toBeCloseTo(0.5, 6);
  });

  it("scales with rawScore", () => {
    const s = signal({ rawScore: 0.6, collectedAt: daysAgo(TREND_HALF_LIFE_DAYS) });
    expect(computeTrendScore(s, NOW)).toBeCloseTo(0.3, 6);
  });

  it("returns 0 past the max age", () => {
    const s = signal({ collectedAt: daysAgo(TREND_MAX_AGE_DAYS + 1) });
    expect(computeTrendScore(s, NOW)).toBe(0);
  });

  it("returns 0 for future or invalid timestamps", () => {
    expect(computeTrendScore(signal({ collectedAt: daysAgo(-1) }), NOW)).toBe(0);
    expect(computeTrendScore(signal({ collectedAt: "not-a-date" }), NOW)).toBe(0);
  });

  it("clamps out-of-range rawScore into [0,1]", () => {
    expect(computeTrendScore(signal({ rawScore: 5 }), NOW)).toBeCloseTo(1, 6);
    expect(computeTrendScore(signal({ rawScore: -2 }), NOW)).toBe(0);
  });
});

describe("applyTrendingBoost", () => {
  it("boosts similarity proportionally and adds the trending tag", () => {
    const [boosted] = applyTrendingBoost([candidate("p1")], new Map([["p1", 1]]));
    expect(boosted.similarity).toBeCloseTo(0.7 + TREND_BOOST_WEIGHT, 6);
    expect(boosted.tags).toContain(TRENDING_TAG);
  });

  it("leaves candidates without a signal untouched", () => {
    const input = candidate("p2", { tags: ["onsen"] });
    const [out] = applyTrendingBoost([input], new Map([["p1", 1]]));
    expect(out.similarity).toBe(0.7);
    expect(out.tags).toEqual(["onsen"]);
  });

  it("caps boosted similarity at 1", () => {
    const [out] = applyTrendingBoost([candidate("p1", { similarity: 0.95 })], new Map([["p1", 1]]));
    expect(out.similarity).toBe(1);
  });

  it("does not duplicate the trending tag", () => {
    const input = candidate("p1", { tags: [TRENDING_TAG] });
    const [out] = applyTrendingBoost([input], new Map([["p1", 0.8]]));
    expect(out.tags.filter((t) => t === TRENDING_TAG)).toHaveLength(1);
  });

  it("does not mutate the input candidates", () => {
    const input = candidate("p1");
    applyTrendingBoost([input], new Map([["p1", 1]]));
    expect(input.similarity).toBe(0.7);
    expect(input.tags).toEqual([]);
  });
});

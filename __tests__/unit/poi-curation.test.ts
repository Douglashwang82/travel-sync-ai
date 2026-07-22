import { describe, it, expect } from "vitest";

import { suggestCategory, validateCurationPatch } from "@/services/admin/poi-curation";
import {
  buildCorpusOverview,
  MIN_EXPOSURES,
  type CorpusPoiRow,
  type PoiStatsRow,
} from "@/services/admin/poi-analytics";

describe("suggestCategory", () => {
  it("maps restaurants to food regardless of tags", () => {
    expect(suggestCategory("restaurant", ["temple"])).toBe("food");
  });

  it("maps hotels and transport to other", () => {
    expect(suggestCategory("hotel", [])).toBe("other");
    expect(suggestCategory("transport", [])).toBe("other");
  });

  it("maps tag keywords to their category", () => {
    expect(suggestCategory("activity", ["shrine"])).toBe("culture");
    expect(suggestCategory("activity", ["onsen"])).toBe("wellness");
    expect(suggestCategory("activity", ["museum"])).toBe("museum");
    expect(suggestCategory("activity", ["bar", "night"])).toBe("nightlife");
    expect(suggestCategory("activity", ["park"])).toBe("nature");
    expect(suggestCategory("activity", ["market"])).toBe("shopping");
  });

  it("matches keywords in the name when tags are empty", () => {
    expect(suggestCategory("activity", [], "Tokyo National Museum")).toBe("museum");
    expect(suggestCategory("activity", [], "Ueno Park")).toBe("nature");
  });

  it("detects food-ish activities (cafés)", () => {
    expect(suggestCategory("activity", ["cafe"])).toBe("food");
  });

  it("defaults unmatched activities to landmark", () => {
    expect(suggestCategory("activity", ["iconic"])).toBe("landmark");
  });
});

describe("validateCurationPatch", () => {
  it("accepts a full valid patch and normalizes labels", () => {
    const res = validateCurationPatch({
      category: "food",
      labels: ["Must Try", "must try", "  "],
      curation_status: "approved",
      quality_score: 0.8,
      curation_notes: "great",
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value).toEqual({
        category: "food",
        labels: ["must_try"],
        curation_status: "approved",
        quality_score: 0.8,
        curation_notes: "great",
      });
    }
  });

  it("only includes keys present in the body", () => {
    const res = validateCurationPatch({ curation_status: "hidden" });
    expect(res.ok).toBe(true);
    if (res.ok) expect(Object.keys(res.value)).toEqual(["curation_status"]);
  });

  it("rejects unknown category / status and out-of-range quality", () => {
    expect(validateCurationPatch({ category: "vibes" }).ok).toBe(false);
    expect(validateCurationPatch({ curation_status: "deleted" }).ok).toBe(false);
    expect(validateCurationPatch({ quality_score: 3 }).ok).toBe(false);
  });

  it("allows explicit nulls to clear category / quality / notes", () => {
    const res = validateCurationPatch({ category: null, quality_score: null, curation_notes: null });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value).toEqual({ category: null, quality_score: null, curation_notes: null });
  });
});

describe("buildCorpusOverview", () => {
  const poi = (extras: Partial<CorpusPoiRow>): CorpusPoiRow => ({
    place_id: "p",
    name: "POI",
    destination_name: "Tokyo, Japan",
    item_type: "activity",
    source: "google_places",
    category: null,
    labels: [],
    curation_status: "unreviewed",
    quality_score: null,
    ...extras,
  });

  const stat = (extras: Partial<PoiStatsRow>): PoiStatsRow => ({
    place_id: "p",
    exposures: 10,
    selections: 5,
    selection_rate: 0.5,
    avg_shortlist_rank: 10,
    avg_similarity: 0.7,
    avg_similarity_selected: 0.75,
    avg_similarity_rejected: 0.65,
    last_exposure_at: "2026-07-01T00:00:00Z",
    ...extras,
  });

  it("rolls up counts, exposures and rates by category", () => {
    const pois = [
      poi({ place_id: "a", category: "food" }),
      poi({ place_id: "b", category: "food" }),
      poi({ place_id: "c" }),
    ];
    const stats = new Map([["a", stat({ place_id: "a", exposures: 10, selections: 4, selection_rate: 0.4 })]]);
    const overview = buildCorpusOverview(pois, stats, new Map());

    expect(overview.totalPois).toBe(3);
    expect(overview.uncategorized).toBe(1);
    const food = overview.byCategory.find((g) => g.key === "food");
    expect(food).toMatchObject({ pois: 2, exposures: 10, selections: 4, selectionRate: 0.4 });
    const none = overview.byCategory.find((g) => g.key === "(uncategorized)");
    expect(none).toMatchObject({ pois: 1, exposures: 0, selectionRate: null });
  });

  it("computes the exposure-weighted similarity split", () => {
    const pois = [poi({ place_id: "a" }), poi({ place_id: "b" })];
    const stats = new Map([
      ["a", stat({ place_id: "a", exposures: 10, selections: 10, avg_similarity_selected: 0.8, avg_similarity_rejected: null })],
      ["b", stat({ place_id: "b", exposures: 10, selections: 0, selection_rate: 0, avg_similarity_selected: null, avg_similarity_rejected: 0.6 })],
    ]);
    const overview = buildCorpusOverview(pois, stats, new Map());
    expect(overview.similaritySplit.selected).toBeCloseTo(0.8, 6);
    expect(overview.similaritySplit.rejected).toBeCloseTo(0.6, 6);
  });

  it("splits top and underperformers at the exposure floor", () => {
    const pois = [
      poi({ place_id: "hot", name: "Hot" }),
      poi({ place_id: "cold", name: "Cold" }),
      poi({ place_id: "thin", name: "Thin" }),
    ];
    const stats = new Map([
      ["hot", stat({ place_id: "hot", exposures: MIN_EXPOSURES, selections: 5, selection_rate: 1 })],
      ["cold", stat({ place_id: "cold", exposures: MIN_EXPOSURES, selections: 0, selection_rate: 0 })],
      // Below the floor — excluded from both lists.
      ["thin", stat({ place_id: "thin", exposures: MIN_EXPOSURES - 1, selections: 0, selection_rate: 0 })],
    ]);
    const overview = buildCorpusOverview(pois, stats, new Map());
    expect(overview.topPerformers[0]?.placeId).toBe("hot");
    expect(overview.underperformers[0]?.placeId).toBe("cold");
    expect(overview.topPerformers.some((r) => r.placeId === "thin")).toBe(false);
  });

  it("surfaces trending POIs with zero exposure", () => {
    const pois = [poi({ place_id: "viral", name: "Viral" }), poi({ place_id: "seen" })];
    const stats = new Map([["seen", stat({ place_id: "seen" })]]);
    const trend = new Map([
      ["viral", 0.9],
      ["seen", 0.9],
    ]);
    const overview = buildCorpusOverview(pois, stats, trend);
    expect(overview.trendingUnexposed.map((r) => r.placeId)).toEqual(["viral"]);
  });
});

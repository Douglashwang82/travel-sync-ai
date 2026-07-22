import { describe, it, expect } from "vitest";

import {
  buildTrendingHomePoi,
  isTrendingPoiId,
  TRENDING_POI_ID_PREFIX,
  type TrendingPoiSource,
} from "@/services/home-demo/trending-pois";

function source(extras: Partial<TrendingPoiSource> = {}): TrendingPoiSource {
  return {
    placeId: "ChIJabc123",
    name: "Omoide Yokocho",
    itemType: "restaurant",
    tags: ["izakaya", "night"],
    lat: 35.69,
    lng: 139.7,
    destination: "Tokyo, Japan",
    reason: "Viral on TikTok food tours",
    platforms: ["tiktok", "instagram"],
    score: 0.8,
    ...extras,
  };
}

describe("buildTrendingHomePoi", () => {
  it("namespaces the id and carries the trending payload", () => {
    const poi = buildTrendingHomePoi(source(), "jp", "Tokyo");
    expect(poi.id).toBe(`${TRENDING_POI_ID_PREFIX}ChIJabc123`);
    expect(isTrendingPoiId(poi.id)).toBe(true);
    expect(poi.country).toBe("jp");
    expect(poi.city).toBe("Tokyo");
    expect(poi.trending).toEqual({ platforms: ["tiktok", "instagram"], score: 0.8 });
  });

  it("maps restaurants to the food category and keeps meal typing for the solver", () => {
    const poi = buildTrendingHomePoi(source(), "jp", "Tokyo");
    expect(poi.itemType).toBe("restaurant");
    expect(poi.category).toBe("food");
  });

  it("maps non-restaurant corpus types to activity with a tag-derived category", () => {
    const poi = buildTrendingHomePoi(
      source({ itemType: "activity", tags: ["shrine", "temple"] }),
      "jp",
      "Kyoto"
    );
    expect(poi.itemType).toBe("activity");
    expect(poi.category).toBe("culture");
  });

  it("uses the reason as the blurb and falls back to a platform line", () => {
    expect(buildTrendingHomePoi(source(), "jp", "Tokyo").blurb).toBe("Viral on TikTok food tours");
    const fallback = buildTrendingHomePoi(source({ reason: "" }), "jp", "Tokyo");
    expect(fallback.blurb).toContain("tiktok");
  });

  it("prepends the trending tag so wall search finds live cards", () => {
    const poi = buildTrendingHomePoi(source(), "jp", "Tokyo");
    expect(poi.tags[0]).toBe("trending");
    expect(poi.tags).toContain("tiktok");
  });

  it("is deterministic for the same source", () => {
    const a = buildTrendingHomePoi(source(), "jp", "Tokyo");
    const b = buildTrendingHomePoi(source(), "jp", "Tokyo");
    expect(a).toEqual(b);
    expect(a.hue).toBeGreaterThanOrEqual(0);
    expect(a.hue).toBeLessThan(360);
  });

  it("defaults platforms to instagram when the signal has none", () => {
    const poi = buildTrendingHomePoi(source({ platforms: [] }), "jp", "Tokyo");
    expect(poi.trending?.platforms).toEqual(["instagram"]);
  });
});

describe("isTrendingPoiId", () => {
  it("accepts only namespaced ids", () => {
    expect(isTrendingPoiId("trend:ChIJx")).toBe(true);
    expect(isTrendingPoiId("jp-shibuya-crossing")).toBe(false);
  });
});

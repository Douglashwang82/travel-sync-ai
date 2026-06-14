import { describe, expect, it } from "vitest";

import {
  HOME_COUNTRIES,
  HOME_POIS,
  getHomeCountry,
  getHomePois,
} from "@/lib/home-survey";
import {
  MAX_STOPS_PER_DAY,
  addDays,
  buildHomeItinerary,
  clusterPoisIntoDays,
  defaultStartDate,
  fallbackScheduleDay,
  formatLocalCost,
  formatMinutes,
  resolveAssignment,
  scheduleDays,
  weekdayOf,
} from "@/services/home-demo/itinerary";

const jp = getHomeCountry("jp")!;
const jpPois = getHomePois("jp");

describe("home survey catalog", () => {
  it("has three countries with unique codes", () => {
    expect(HOME_COUNTRIES.map((c) => c.code).sort()).toEqual(["jp", "tw", "us"]);
  });

  it("has unique POI ids that all reference a known country", () => {
    const ids = HOME_POIS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    const codes = new Set(HOME_COUNTRIES.map((c) => c.code));
    for (const poi of HOME_POIS) {
      expect(codes.has(poi.country)).toBe(true);
      expect(Math.abs(poi.lat)).toBeLessThanOrEqual(90);
      expect(Math.abs(poi.lng)).toBeLessThanOrEqual(180);
      expect(poi.stayMinutes).toBeGreaterThan(0);
      expect(poi.costUsd).toBeGreaterThanOrEqual(0);
    }
  });

  it("offers a media-rich wall per country (≥8 POIs, all media kinds)", () => {
    for (const country of HOME_COUNTRIES) {
      const pois = getHomePois(country.code);
      expect(pois.length).toBeGreaterThanOrEqual(8);
      expect(new Set(pois.map((p) => p.media))).toEqual(new Set(["photo", "video", "insta"]));
    }
  });
});

describe("clusterPoisIntoDays", () => {
  it("partitions every POI exactly once within the per-day cap", () => {
    const clusters = clusterPoisIntoDays(jpPois);
    const flat = clusters.flat();
    expect(flat.length).toBe(jpPois.length);
    expect(new Set(flat.map((p) => p.id)).size).toBe(jpPois.length);
    for (const day of clusters) {
      expect(day.length).toBeGreaterThan(0);
      expect(day.length).toBeLessThanOrEqual(MAX_STOPS_PER_DAY);
    }
  });

  it("keeps far-apart cities on separate days", () => {
    const tokyo = jpPois.filter((p) => p.city === "Tokyo").slice(0, 3);
    const kyoto = jpPois.filter((p) => p.city === "Kyoto").slice(0, 3);
    const clusters = clusterPoisIntoDays([...tokyo, ...kyoto], 3);
    for (const day of clusters) {
      expect(new Set(day.map((p) => p.city)).size).toBe(1);
    }
  });
});

describe("resolveAssignment", () => {
  const picks = jpPois.slice(0, 4);

  it("accepts a clean partition", () => {
    const days = resolveAssignment(
      [[picks[0].id, picks[1].id], [picks[2].id, picks[3].id]],
      picks,
    );
    expect(days).not.toBeNull();
    expect(days!.flat().map((p) => p.id).sort()).toEqual(picks.map((p) => p.id).sort());
  });

  it("rejects invented ids, duplicates, omissions and oversized days", () => {
    expect(resolveAssignment([[picks[0].id, "made-up"]], picks.slice(0, 2))).toBeNull();
    expect(resolveAssignment([[picks[0].id, picks[0].id]], [picks[0]])).toBeNull();
    expect(resolveAssignment([[picks[0].id]], picks.slice(0, 2))).toBeNull();
    expect(
      resolveAssignment([picks.map((p) => p.id).concat(jpPois[5].id)], [...picks, jpPois[5]]),
    ).toBeNull();
  });
});

describe("fallbackScheduleDay", () => {
  it("produces monotonically increasing times inside the day window", () => {
    const day = fallbackScheduleDay(jpPois.filter((p) => p.city === "Tokyo").slice(0, 4));
    expect(day.stops.length).toBe(4);
    let cursor = 0;
    for (const stop of day.stops) {
      expect(stop.arriveMinutes).toBeGreaterThanOrEqual(cursor);
      expect(stop.departMinutes).toBeGreaterThan(stop.arriveMinutes);
      cursor = stop.departMinutes;
    }
    expect(day.stops[0].arriveMinutes).toBe(9 * 60);
    expect(day.stops.at(-1)!.departMinutes).toBeLessThanOrEqual(22 * 60);
  });

  it("lands a restaurant near the lunch window when one is picked", () => {
    const tokyo = jpPois.filter((p) => p.city === "Tokyo" && p.itemType !== "restaurant").slice(0, 3);
    const ramen = jpPois.find((p) => p.id === "jp-ichiran")!;
    const day = fallbackScheduleDay([...tokyo, ramen]);
    const lunch = day.stops.find((s) => s.poi.id === ramen.id)!;
    expect(Math.abs(lunch.arriveMinutes - 12.5 * 60)).toBeLessThanOrEqual(120);
  });
});

describe("scheduleDays + buildHomeItinerary", () => {
  it("builds a complete dated, costed itinerary from a selection", () => {
    const picks = jpPois.slice(0, 8);
    const clusters = clusterPoisIntoDays(picks);
    const startDate = "2026-07-11";
    const { days: scheduled } = scheduleDays(clusters, weekdayOf(startDate));
    expect(scheduled.length).toBe(clusters.length);
    expect(scheduled.flatMap((d) => d.stops).length).toBe(picks.length);

    const itinerary = buildHomeItinerary({
      country: jp,
      scheduled,
      startDate,
      title: "Test trip",
      summary: "Summary",
      themes: [],
      locale: "en",
    });

    expect(itinerary.days.length).toBe(scheduled.length);
    expect(itinerary.days[0].date).toBe(startDate);
    for (let i = 1; i < itinerary.days.length; i++) {
      expect(itinerary.days[i].date).toBe(addDays(startDate, i));
    }
    const sumDays = itinerary.days.reduce((s, d) => s + d.dayCostUsd, 0);
    expect(itinerary.totalCostUsd).toBe(sumDays);
    const sumStops = itinerary.days.flatMap((d) => d.stops).reduce((s, x) => s + x.costUsd, 0);
    expect(itinerary.totalCostUsd).toBe(sumStops);
    for (const day of itinerary.days) {
      for (const stop of day.stops) {
        expect(stop.arrive).toMatch(/^\d{2}:\d{2}$/);
        expect(stop.depart).toMatch(/^\d{2}:\d{2}$/);
      }
    }
  });
});

describe("formatting helpers", () => {
  it("formats minutes as HH:MM", () => {
    expect(formatMinutes(9 * 60)).toBe("09:00");
    expect(formatMinutes(13 * 60 + 5)).toBe("13:05");
  });

  it("converts and rounds local costs per currency", () => {
    expect(formatLocalCost(0, jp)).toBe("¥0");
    // 12 USD × 155 = 1860 → rounded to the nearest 100 = 1900
    expect(formatLocalCost(12, jp)).toBe("¥1,900");
    const us = getHomeCountry("us")!;
    expect(formatLocalCost(28, us)).toBe("$28");
  });

  it("defaults the start date to a Saturday at least two weeks out", () => {
    const now = new Date("2026-06-12T10:00:00Z");
    const start = defaultStartDate(now);
    expect(weekdayOf(start)).toBe(6);
    const diffDays = (new Date(`${start}T00:00:00Z`).getTime() - new Date("2026-06-12T00:00:00Z").getTime()) / 86_400_000;
    expect(diffDays).toBeGreaterThanOrEqual(14);
  });
});

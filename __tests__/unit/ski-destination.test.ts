import { describe, it, expect } from "vitest";
import { detectJapanSkiDestination } from "@/lib/ski-destination";

describe("detectJapanSkiDestination", () => {
  it("matches the canonical region name", () => {
    const r = detectJapanSkiDestination("Niseko");
    expect(r.match).toBe(true);
    if (r.match) expect(r.region.slug).toBe("niseko");
  });

  it("matches the Traditional Chinese region name", () => {
    const r = detectJapanSkiDestination("二世谷");
    expect(r.match).toBe(true);
    if (r.match) expect(r.region.slug).toBe("niseko");
  });

  it("matches the Japanese region name", () => {
    const r = detectJapanSkiDestination("ニセコ");
    expect(r.match).toBe(true);
    if (r.match) expect(r.region.slug).toBe("niseko");
  });

  it("matches longer destination strings that contain the region", () => {
    const r = detectJapanSkiDestination("Niseko Grand Hirafu, Hokkaido");
    expect(r.match).toBe(true);
    if (r.match) expect(r.region.slug).toBe("niseko");
  });

  it("matches the slug form", () => {
    const r = detectJapanSkiDestination("nozawa-onsen");
    expect(r.match).toBe(true);
    if (r.match) expect(r.region.slug).toBe("nozawa-onsen");
  });

  it("matches 'Hakuba ski'", () => {
    const r = detectJapanSkiDestination("Hakuba ski");
    expect(r.match).toBe(true);
    if (r.match) expect(r.region.slug).toBe("hakuba");
  });

  it("does NOT match a bare prefecture like 'Nagano'", () => {
    // Prefecture-only is intentionally not a strong alias — many Nagano trips
    // are non-ski. The orchestrator still surfaces ski POIs via the broader
    // alias set on the stored rows.
    expect(detectJapanSkiDestination("Nagano").match).toBe(false);
  });

  it("does NOT match a bare country / 'Japan'", () => {
    expect(detectJapanSkiDestination("Japan").match).toBe(false);
    expect(detectJapanSkiDestination("Tokyo, Japan").match).toBe(false);
    expect(detectJapanSkiDestination("Osaka").match).toBe(false);
  });

  it("returns no match for null / empty / whitespace", () => {
    expect(detectJapanSkiDestination(null).match).toBe(false);
    expect(detectJapanSkiDestination(undefined).match).toBe(false);
    expect(detectJapanSkiDestination("").match).toBe(false);
    expect(detectJapanSkiDestination("   ").match).toBe(false);
  });

  it("matches all six v1 regions by canonical name", () => {
    for (const name of ["Niseko", "Hakuba", "Naeba", "Nozawa Onsen", "Shiga Kogen", "Zao Onsen"]) {
      const r = detectJapanSkiDestination(name);
      expect(r.match, `${name} should match`).toBe(true);
    }
  });
});

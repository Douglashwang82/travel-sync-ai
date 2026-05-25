import { describe, it, expect } from "vitest";
import {
  REGIONS,
  regionAliases,
  resortTags,
  hotelTags,
  restaurantTags,
  activityTags,
  transportTags,
  buildResortRow,
  buildHotelRow,
  buildRestaurantRow,
  buildActivityRow,
  buildTransportRow,
} from "@/lib/ski-ingest";

const niseko = REGIONS.find((r) => r.slug === "niseko")!;
const hakuba = REGIONS.find((r) => r.slug === "hakuba")!;

describe("REGIONS", () => {
  it("covers the six v1 deep-ingest regions", () => {
    expect(REGIONS.map((r) => r.slug).sort()).toEqual(
      ["hakuba", "naeba", "niseko", "nozawa-onsen", "shiga-kogen", "zao-onsen"],
    );
  });

  it("every region has a non-empty canonical name and prefecture", () => {
    for (const r of REGIONS) {
      expect(r.region.length).toBeGreaterThan(0);
      expect(r.prefecture.length).toBeGreaterThan(0);
    }
  });
});

describe("regionAliases", () => {
  it("includes the region, prefecture, zh/ja variants, and Japan-ski synonyms", () => {
    const aliases = regionAliases(niseko);
    expect(aliases).toContain("niseko");
    expect(aliases).toContain("二世谷");
    expect(aliases).toContain("ニセコ");
    expect(aliases).toContain("hokkaido");
    expect(aliases).toContain("北海道");
    expect(aliases).toContain("hokkaido, japan");
    expect(aliases).toContain("japan ski");
    expect(aliases).toContain("japan ski trip");
  });

  it("returns lowercased values only (matches search_pois_by_vibe contract)", () => {
    for (const a of regionAliases(hakuba)) {
      expect(a).toEqual(a.toLowerCase());
    }
  });
});

describe("tag derivation", () => {
  it("resort: ski_resort + adventure + nightlife when night_skiing", () => {
    const tags = resortTags({ id: "x", name: "X", night_skiing: true });
    expect(tags).toContain("ski_resort");
    expect(tags).toContain("adventure");
    expect(tags).toContain("night_skiing");
    expect(tags).toContain("nightlife");
  });

  it("hotel with onsen amenity gets onsen + relaxed", () => {
    const tags = hotelTags({ id: "x", name: "X", amenities: ["onsen", "spa"], ski_in_ski_out: true, category: "luxury" });
    expect(tags).toContain("onsen");
    expect(tags).toContain("relaxed");
    expect(tags).toContain("ski_in_ski_out");
    expect(tags).toContain("luxury");
  });

  it("restaurant with $$$$ band gets fine_dining + foodie", () => {
    const tags = restaurantTags({ id: "x", name: "X", price_band: "$$$$", cuisine: "Modern_Italian" });
    expect(tags).toContain("foodie");
    expect(tags).toContain("fine_dining");
    expect(tags).toContain("modern_italian");
  });

  it("activity of type=onsen yields onsen + relaxed", () => {
    const tags = activityTags({ id: "x", name: "X", type: "onsen" });
    expect(tags).toEqual(expect.arrayContaining(["onsen", "relaxed"]));
  });

  it("activity of type=snow_activity yields snow_activity + adventure + family", () => {
    const tags = activityTags({ id: "x", name: "X", type: "snow_activity" });
    expect(tags).toEqual(expect.arrayContaining(["snow_activity", "adventure", "family"]));
  });

  it("activity falls back to ['activity'] when type is missing", () => {
    expect(activityTags({ id: "x", name: "X" })).toEqual(["activity"]);
  });

  it("transport tags include transport + the gateway type", () => {
    const tags = transportTags({ id: "x", name: "X", type: "train_station" });
    expect(tags).toContain("transport");
    expect(tags).toContain("train_station");
    expect(tags).toContain("gateway");
  });
});

describe("row builders", () => {
  it("resort row carries destination_name = region and includes resort name in aliases", () => {
    const row = buildResortRow(
      { id: "niseko-grand-hirafu", name: "Niseko Grand Hirafu", name_ja: "ニセコグラン・ヒラフ", part_of: "Niseko United", lat: 42.86, lng: 140.7, night_skiing: true, notes: "Largest" },
      niseko,
    );
    expect(row.destination_name).toBe("Niseko");
    expect(row.item_type).toBe("activity");
    expect(row.destination_aliases).toContain("niseko-grand-hirafu");
    expect(row.destination_aliases).toContain("niseko grand hirafu");
    expect(row.destination_aliases).toContain("niseko united");
    expect(row.tags).toContain("ski_resort");
    expect(row.live_data.lat).toBe(42.86);
    expect(row.source).toBe("curated:japan-ski-region");
  });

  it("hotel row uses item_type=hotel", () => {
    const row = buildHotelRow(
      { id: "park-hyatt-niseko-hanazono", name: "Park Hyatt Niseko Hanazono", category: "luxury", price_band: "$$$$", amenities: ["onsen"] },
      niseko,
    );
    expect(row.item_type).toBe("hotel");
    expect(row.tags).toContain("luxury");
    expect(row.tags).toContain("onsen");
  });

  it("restaurant row uses item_type=restaurant", () => {
    const row = buildRestaurantRow({ id: "pilar", name: "Pilar", cuisine: "modern_italian", price_band: "$$$$" }, hakuba);
    expect(row.item_type).toBe("restaurant");
    expect(row.destination_name).toBe("Hakuba");
  });

  it("activity row uses item_type=activity", () => {
    const row = buildActivityRow({ id: "yukoro-onsen", name: "Yukoro Onsen", type: "onsen" }, niseko);
    expect(row.item_type).toBe("activity");
    expect(row.tags).toContain("onsen");
  });

  it("transport row uses item_type=transport", () => {
    const row = buildTransportRow({ id: "nagano-station", name: "Nagano Station", type: "train_station" }, hakuba);
    expect(row.item_type).toBe("transport");
    expect(row.tags).toContain("train_station");
  });

  it("place_id is preserved verbatim so re-runs upsert in place", () => {
    const row = buildHotelRow({ id: "roka-apartments-hakuba", name: "Roka Apartments Hakuba" }, hakuba);
    expect(row.place_id).toBe("roka-apartments-hakuba");
  });
});

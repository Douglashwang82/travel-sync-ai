import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Google Places batch fetcher so we can assert when it is and isn't
// called. Everything else in poi-engine is exercised via its real module.

const getPlaceDetailsBatchMock = vi.fn();
vi.mock("@/services/decisions/places", () => ({
  getPlaceDetailsBatch: (ids: string[]) => getPlaceDetailsBatchMock(ids),
  // Pass-through stubs so the real module is replaceable without breaking
  // unrelated imports from poi-engine's deps.
  searchPlaces: vi.fn(),
}));

import { enrichWithLiveData, type PoiCandidate } from "@/services/trip-generation/poi-engine";
import type { PlaceLiveData } from "@/services/decisions/places";

function candidate(id: string, extras: Partial<PoiCandidate> = {}): PoiCandidate {
  return {
    placeId: id,
    name: id,
    itemType: "activity",
    tags: [],
    description: "",
    lat: 35,
    lng: 139,
    similarity: 1,
    ...extras,
  };
}

function live(id: string, extras: Partial<PlaceLiveData> = {}): PlaceLiveData {
  return {
    placeId: id,
    name: id,
    address: "addr",
    rating: 4,
    priceLevel: "$$",
    lat: 35,
    lng: 139,
    openingPeriods: [],
    ...extras,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("enrichWithLiveData — liveData short-circuit", () => {
  it("uses row-level liveData and does not call the Google fetcher", async () => {
    const curated = candidate("rusutsu", {
      liveData: live("rusutsu", {
        openingPeriods: [{ openDay: 1, openMinutes: 510, closeDay: 1, closeMinutes: 990 }],
      }),
    });
    getPlaceDetailsBatchMock.mockResolvedValue([]);

    const result = await enrichWithLiveData([curated]);

    expect(getPlaceDetailsBatchMock).not.toHaveBeenCalled();
    expect(result[0].live?.openingPeriods).toEqual([
      { openDay: 1, openMinutes: 510, closeDay: 1, closeMinutes: 990 },
    ]);
  });

  it("only fetches for candidates without liveData", async () => {
    const curated = candidate("rusutsu", { liveData: live("rusutsu") });
    const google = candidate("ChIJ_abc");
    getPlaceDetailsBatchMock.mockResolvedValueOnce([live("ChIJ_abc")]);

    await enrichWithLiveData([curated, google]);

    expect(getPlaceDetailsBatchMock).toHaveBeenCalledTimes(1);
    expect(getPlaceDetailsBatchMock).toHaveBeenCalledWith(["ChIJ_abc"]);
  });

  it("skips the Google call entirely when every candidate carries liveData", async () => {
    const cs = [
      candidate("rusutsu", { liveData: live("rusutsu") }),
      candidate("kiroro", { liveData: live("kiroro") }),
    ];
    getPlaceDetailsBatchMock.mockResolvedValue([]);

    const result = await enrichWithLiveData(cs);

    expect(getPlaceDetailsBatchMock).not.toHaveBeenCalled();
    expect(result.map((r) => r.live?.placeId)).toEqual(["rusutsu", "kiroro"]);
  });

  it("falls through to the Google fetcher when liveData is null (Google-sourced)", async () => {
    const c = candidate("ChIJ_xyz");
    getPlaceDetailsBatchMock.mockResolvedValueOnce([live("ChIJ_xyz", { rating: 4.5 })]);

    const result = await enrichWithLiveData([c]);

    expect(getPlaceDetailsBatchMock).toHaveBeenCalledWith(["ChIJ_xyz"]);
    expect(result[0].live?.rating).toBe(4.5);
  });

  it("does not call Google for local dataset IDs without liveData", async () => {
    const local = candidate("local:japan-ski-trip%2Fniseko%2Ftransport%2Froutes%2Fcts-rental-car", {
      lat: 42.8,
      lng: 140.7,
    });
    getPlaceDetailsBatchMock.mockResolvedValue([]);

    const result = await enrichWithLiveData([local]);

    expect(getPlaceDetailsBatchMock).not.toHaveBeenCalled();
    expect(result[0].live).toMatchObject({
      placeId: local.placeId,
      name: local.name,
      lat: 42.8,
      lng: 140.7,
      openingPeriods: [],
    });
  });
});

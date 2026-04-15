import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getPlaceDetails, searchPlaces } from "@/services/decisions/places";

const mockPlace = {
  id: "ChIJplace1",
  displayName: { text: "Park Hyatt Tokyo" },
  formattedAddress: "3-7-1-2 Nishi Shinjuku",
  rating: 4.6,
  priceLevel: "PRICE_LEVEL_EXPENSIVE",
  photos: [{ name: "places/ChIJplace1/photos/photo1" }],
};

function makeOkResponse(places: unknown[] = [mockPlace]) {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve({ places }),
    text: () => Promise.resolve(""),
  } as unknown as Response;
}

function makeErrorResponse(status = 403) {
  return {
    ok: false,
    status,
    json: () => Promise.resolve({}),
    text: () => Promise.resolve(`HTTP ${status}`),
  } as unknown as Response;
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
  process.env.GOOGLE_PLACES_API_KEY = "test-key";
  delete process.env.GOOGLE_MAPS_SERVER_API_KEY;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("searchPlaces - no API key", () => {
  it("returns network_error immediately without calling fetch", async () => {
    delete process.env.GOOGLE_PLACES_API_KEY;

    const result = await searchPlaces("Tokyo", "hotel");

    expect(result.candidates).toHaveLength(0);
    expect(result.errorKind).toBe("network_error");
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });
});

describe("searchPlaces - success", () => {
  it("returns normalized low-cost candidates and errorKind:null", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeOkResponse());

    const result = await searchPlaces("Tokyo", "hotel");

    expect(result.errorKind).toBeNull();
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].name).toBe("Park Hyatt Tokyo");
    expect(result.candidates[0].rating).toBeNull();
    expect(result.candidates[0].priceLevel).toBeNull();
    expect(result.candidates[0].placeId).toBe("ChIJplace1");
    expect(result.candidates[0].address).toBe("3-7-1-2 Nishi Shinjuku");
    expect(result.candidates[0].photoUrl).toBeNull();
  });

  it("returns no_results when API responds ok but places array is empty", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeOkResponse([]));

    const result = await searchPlaces("MiddleOfNowhere", "hotel");

    expect(result.candidates).toHaveLength(0);
    expect(result.errorKind).toBe("no_results");
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it("respects maxResults and caps the returned candidates", async () => {
    const places = Array.from({ length: 10 }, (_, i) => ({
      ...mockPlace,
      id: `place-${i}`,
      displayName: { text: `Hotel ${i}` },
    }));
    vi.mocked(fetch).mockResolvedValueOnce(makeOkResponse(places));

    const result = await searchPlaces("Tokyo", "hotel", 3);

    expect(result.candidates).toHaveLength(3);
  });

  it("builds the correct text query and low-cost field mask", async () => {
    vi.mocked(fetch).mockResolvedValue(makeOkResponse());

    await searchPlaces("Tokyo", "restaurant");

    const [, init] = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.textQuery).toContain("restaurants");
    expect(body.textQuery).toContain("Tokyo");
    expect((init as RequestInit).headers).toMatchObject({
      "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress",
    });
  });
});

describe("searchPlaces - API error response", () => {
  it("returns network_error immediately without retrying on non-2xx", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeErrorResponse(403));

    const result = await searchPlaces("Tokyo", "hotel");

    expect(result.candidates).toHaveLength(0);
    expect(result.errorKind).toBe("network_error");
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });
});

describe("searchPlaces - retry on network throw", () => {
  it("retries on network throw and succeeds on third attempt", async () => {
    vi.useFakeTimers();

    vi.mocked(fetch)
      .mockRejectedValueOnce(new Error("Network error"))
      .mockRejectedValueOnce(new Error("Network error"))
      .mockResolvedValueOnce(makeOkResponse());

    const promise = searchPlaces("Tokyo", "hotel");
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.errorKind).toBeNull();
    expect(result.candidates).toHaveLength(1);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(3);
  });

  it("returns network_error after exhausting all retries", async () => {
    vi.useFakeTimers();

    vi.mocked(fetch).mockRejectedValue(new Error("Network error"));

    const promise = searchPlaces("Tokyo", "hotel");
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.candidates).toHaveLength(0);
    expect(result.errorKind).toBe("network_error");
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(3);
  });

  it("retries with increasing delays (1s then 2s)", async () => {
    vi.useFakeTimers();
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    vi.mocked(fetch)
      .mockRejectedValueOnce(new Error("fail"))
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValueOnce(makeOkResponse());

    const promise = searchPlaces("Tokyo", "hotel");
    await vi.runAllTimersAsync();
    await promise;

    const delays = setTimeoutSpy.mock.calls.map(([, ms]) => ms);
    expect(delays).toContain(1000);
    expect(delays).toContain(2000);
  });
});

describe("getPlaceDetails", () => {
  it("returns richer details for a selected place", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      {
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            id: "ChIJplace1",
            displayName: { text: "Park Hyatt Tokyo" },
            formattedAddress: "3-7-1-2 Nishi Shinjuku",
            rating: 4.6,
            priceLevel: "PRICE_LEVEL_EXPENSIVE",
            photos: [{ name: "places/ChIJplace1/photos/photo1" }],
            googleMapsUri: "https://maps.google.com/?cid=123",
            location: { latitude: 35.685, longitude: 139.69 },
          }),
        text: () => Promise.resolve(""),
      } as unknown as Response
    );

    const result = await getPlaceDetails("ChIJplace1");

    expect(result).not.toBeNull();
    expect(result?.rating).toBe(4.6);
    expect(result?.priceLevel).toBe("$$$");
    expect(result?.photoUrl).toContain("places/ChIJplace1/photos/photo1");
    expect(result?.photoName).toBe("places/ChIJplace1/photos/photo1");
    expect(result?.googleMapsUrl).toBe("https://maps.google.com/?cid=123");
    expect(result?.lat).toBe(35.685);
    expect(result?.lng).toBe(139.69);
  });

  it("falls back to unified maps key when GOOGLE_PLACES_API_KEY is unset", async () => {
    delete process.env.GOOGLE_PLACES_API_KEY;
    process.env.GOOGLE_MAPS_SERVER_API_KEY = "maps-key";
    vi.mocked(fetch).mockResolvedValueOnce(
      {
        ok: true,
        status: 200,
        json: () => Promise.resolve({ id: "ChIJplace1", displayName: { text: "Park Hyatt Tokyo" } }),
        text: () => Promise.resolve(""),
      } as unknown as Response
    );

    await getPlaceDetails("ChIJplace1");

    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect((init as RequestInit).headers).toMatchObject({
      "X-Goog-Api-Key": "maps-key",
    });
  });
});

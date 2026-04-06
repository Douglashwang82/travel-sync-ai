import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { searchPlaces } from "@/services/decisions/places";

// ── Helpers ───────────────────────────────────────────────────────────────────

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
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// ── No API key ────────────────────────────────────────────────────────────────

describe("searchPlaces — no API key", () => {
  it("returns network_error immediately without calling fetch", async () => {
    delete process.env.GOOGLE_PLACES_API_KEY;

    const result = await searchPlaces("Tokyo", "hotel");

    expect(result.candidates).toHaveLength(0);
    expect(result.errorKind).toBe("network_error");
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });
});

// ── Successful response ───────────────────────────────────────────────────────

describe("searchPlaces — success", () => {
  it("returns normalized candidates and errorKind:null", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeOkResponse());

    const result = await searchPlaces("Tokyo", "hotel");

    expect(result.errorKind).toBeNull();
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].name).toBe("Park Hyatt Tokyo");
    expect(result.candidates[0].rating).toBe(4.6);
    expect(result.candidates[0].priceLevel).toBe("$$$");
    expect(result.candidates[0].placeId).toBe("ChIJplace1");
    expect(result.candidates[0].address).toBe("3-7-1-2 Nishi Shinjuku");
    expect(result.candidates[0].photoUrl).toContain("places/ChIJplace1/photos/photo1");
  });

  it("returns no_results when API responds ok but places array is empty", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeOkResponse([]));

    const result = await searchPlaces("MiddleOfNowhere", "hotel");

    expect(result.candidates).toHaveLength(0);
    expect(result.errorKind).toBe("no_results");
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1); // no retry on empty results
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

  it("builds the correct text query for each item type", async () => {
    vi.mocked(fetch).mockResolvedValue(makeOkResponse());

    await searchPlaces("Tokyo", "restaurant");

    const [, init] = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.textQuery).toContain("restaurants");
    expect(body.textQuery).toContain("Tokyo");
  });
});

// ── Non-2xx API error (quota, bad key) ────────────────────────────────────────

describe("searchPlaces — API error response", () => {
  it("returns network_error immediately without retrying on non-2xx", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeErrorResponse(403));

    const result = await searchPlaces("Tokyo", "hotel");

    expect(result.candidates).toHaveLength(0);
    expect(result.errorKind).toBe("network_error");
    // Only one call — no retry for 4xx errors
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });
});

// ── Network throw with retry ──────────────────────────────────────────────────

describe("searchPlaces — retry on network throw", () => {
  it("retries on network throw and succeeds on third attempt", async () => {
    vi.useFakeTimers();

    vi.mocked(fetch)
      .mockRejectedValueOnce(new Error("Network error"))   // attempt 1
      .mockRejectedValueOnce(new Error("Network error"))   // attempt 2
      .mockResolvedValueOnce(makeOkResponse());             // attempt 3

    const promise = searchPlaces("Tokyo", "hotel");
    // Advance through the retry sleeps (1000ms + 2000ms)
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
    // 1 initial + 2 retries = 3 total attempts
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
    expect(delays).toContain(1000); // first retry delay
    expect(delays).toContain(2000); // second retry delay
  });
});

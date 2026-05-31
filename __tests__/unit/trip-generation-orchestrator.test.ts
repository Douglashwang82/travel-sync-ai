import { describe, it, expect, vi, beforeEach } from "vitest";

// All collaborators are mocked at module load — these are pure unit tests of
// the orchestrator's control flow (pick → solve → repair → persist).

vi.mock("@/services/trip-generation/poi-engine", () => ({
  searchPoisByVibe: vi.fn(),
  enrichWithLiveData: vi.fn(),
  loadPoisByIds: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/services/trip-generation/route-engine", () => ({
  searchRoutesByVibe: vi.fn().mockResolvedValue([]),
  // Default: no routes → all days uncovered → POI-only path (matches the
  // pre-route-tier orchestrator behaviour the older tests were written for).
  // Individual tests override via mockImplementationOnce / mockReturnValueOnce.
  composeFromRoutes: vi.fn((_routes: unknown[], durationDays: number) => ({
    coveredDays: new Map(),
    uncoveredDays: Array.from({ length: durationDays }, (_, i) => i + 1),
    usedPlaceIds: new Set<string>(),
  })),
}));
vi.mock("@/lib/gemini", () => ({
  generateJson: vi.fn(),
  generateEmbedding: vi.fn(),
  GeminiUnavailableError: class GeminiUnavailableError extends Error {},
}));
vi.mock("@/lib/db", () => ({
  createAdminClient: vi.fn(),
}));

import { runGenerationPipeline } from "@/services/trip-generation/orchestrator";
import { searchPoisByVibe, enrichWithLiveData } from "@/services/trip-generation/poi-engine";
import {
  searchRoutesByVibe,
  composeFromRoutes,
} from "@/services/trip-generation/route-engine";
import { loadPoisByIds } from "@/services/trip-generation/poi-engine";
import { generateJson } from "@/lib/gemini";
import { createAdminClient } from "@/lib/db";
import { GenerationFailedError } from "@/services/trip-generation/orchestrator";
import type { EnrichedPoi } from "@/services/trip-generation/poi-engine";
import type { RouteCandidate } from "@/services/trip-generation/route-engine";

function poi(id: string, type: EnrichedPoi["itemType"] = "activity"): EnrichedPoi {
  // Deterministic coords keyed off the id so test runs don't flake on
  // unlucky brute-force orderings.
  const seed = Array.from(id).reduce((acc, c) => acc + c.charCodeAt(0), 0) % 100;
  const lat = 35 + seed * 0.0001;
  const lng = 139 + seed * 0.0001;
  return {
    placeId: id,
    name: `Place ${id}`,
    itemType: type,
    tags: [],
    description: `${id} description`,
    lat,
    lng,
    source: "google_places",
    similarity: 0.9,
    live: {
      placeId: id,
      name: `Place ${id}`,
      address: "addr",
      rating: 4.2,
      priceLevel: "$$",
      lat,
      lng,
      openingPeriods: [],
    },
  };
}

function mockDbHappyPath() {
  const tmpl = { id: "tmpl_1" };
  const ver = { id: "ver_1" };
  const single = vi.fn();
  single.mockResolvedValueOnce({ data: tmpl, error: null }); // trip_templates insert
  single.mockResolvedValueOnce({ data: ver, error: null });  // trip_template_versions insert

  const select = vi.fn(() => ({ single }));
  const eq = vi.fn(() => ({ data: null }));
  const update = vi.fn(() => ({ eq }));
  const insert = vi.fn(() => ({ select, error: null }));

  // Plain insert (no .select) for trip_template_items returns { error: null }
  const fromBuilder = (table: string) => {
    if (table === "trip_template_items") {
      return { insert: vi.fn(() => Promise.resolve({ error: null })) };
    }
    if (table === "trip_templates") {
      // First call: insert→select→single (create); later: update→eq
      return { insert, select, update };
    }
    if (table === "trip_template_versions") {
      return { insert, select };
    }
    return {};
  };
  const from = vi.fn((table: string) => fromBuilder(table));
  // rpc returns a thenable-shaped Promise so the orchestrator's fire-and-forget
  // bump_route_quality call resolves without a network hit.
  const rpc = vi.fn(() => Promise.resolve({ error: null }));
  (createAdminClient as unknown as { mockReturnValue: (v: unknown) => void }).mockReturnValue({ from, rpc });
  return { from, rpc };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("orchestrator — happy path", () => {
  it("retrieves POIs, picks, solves, persists, returns ids", async () => {
    // Day 1 = [activity, activity, restaurant] so the restaurant lands ~12:20
    // (lunch window). Day 2 = [activity] only — no meal-anchor required.
    const shortlist = [
      poi("a", "activity"),
      poi("b", "activity"),
      poi("c", "restaurant"),
      poi("d", "activity"),
    ];
    (searchPoisByVibe as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue(
      shortlist.map((p) => ({ ...p }))
    );
    (enrichWithLiveData as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue(shortlist);

    (generateJson as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
      title: "京都 2 日小旅行",
      summary: "兩天份的慢步調行程，包含寺廟、街區與美食。",
      tags: ["京都", "文化"],
      days: [
        { day_number: 1, place_ids: ["a", "b", "c"] },
        { day_number: 2, place_ids: ["d"] },
      ],
    });

    mockDbHappyPath();

    const out = await runGenerationPipeline({
      authorLineUserId: "U_test",
      answers: {
        destination: "Kyoto",
        duration_days: 2,
        party: "couple",
        party_size: 2,
        budget_tier: "mid",
        vibe: ["relaxed", "culture"],
        pace: "balanced",
      },
    });

    expect(out.templateId).toBe("tmpl_1");
    expect(out.versionId).toBe("ver_1");
    expect(generateJson).toHaveBeenCalledTimes(1);
  });

  it("filters extra LLM tags instead of failing schema validation", async () => {
    const shortlist = [poi("a", "activity"), poi("b", "activity"), poi("c", "restaurant")];
    (searchPoisByVibe as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue(
      shortlist.map((p) => ({ ...p }))
    );
    (enrichWithLiveData as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue(shortlist);

    (generateJson as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
      title: "tag-heavy pick",
      summary: "LLM returned too many tags, but the itinerary itself is valid.",
      tags: ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"],
      days: [{ day_number: 1, place_ids: ["a", "b", "c"] }],
    });

    mockDbHappyPath();

    await expect(
      runGenerationPipeline({
        authorLineUserId: "U_tags",
        answers: {
          destination: "Kyoto",
          duration_days: 1,
          party: "couple",
          party_size: 2,
          budget_tier: "mid",
          vibe: ["relaxed"],
          pace: "balanced",
        },
      })
    ).resolves.toMatchObject({ templateId: "tmpl_1", versionId: "ver_1" });
  });
});

describe("orchestrator — guards", () => {
  it("rejects missing duration_days", async () => {
    await expect(
      runGenerationPipeline({
        authorLineUserId: "U",
        answers: { destination: "Kyoto", party: "solo", party_size: 1, budget_tier: "mid", pace: "balanced" },
      })
    ).rejects.toBeInstanceOf(GenerationFailedError);
  });

  it("rejects empty candidate list", async () => {
    (searchPoisByVibe as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue([]);
    await expect(
      runGenerationPipeline({
        authorLineUserId: "U",
        answers: {
          destination: "Atlantis",
          duration_days: 2,
          party: "solo",
          party_size: 1,
          budget_tier: "mid",
          pace: "balanced",
        },
      })
    ).rejects.toMatchObject({ reason: "no_candidates" });
  });
});

function makeRoute(opts: Partial<RouteCandidate> & { routeId: string; placeIds: string[] }): RouteCandidate {
  return {
    routeId: opts.routeId,
    title: opts.title ?? "Route Title",
    summary: opts.summary ?? "A nice route through the city.",
    vibeTags: opts.vibeTags ?? ["culture"],
    pace: opts.pace ?? "balanced",
    placeIds: opts.placeIds,
    similarity: opts.similarity ?? 0.85,
    boost: opts.boost ?? 0,
    qualityScore: opts.qualityScore ?? 0,
    pinnedVibes: opts.pinnedVibes ?? [],
    finalScore: opts.finalScore ?? 0.85,
    source: opts.source ?? "curated",
  };
}

describe("orchestrator — route layer", () => {
  it("skips LLM picking when routes cover every day", async () => {
    const route = makeRoute({
      routeId: "r1",
      title: "Gion Morning",
      summary: "A walk through Gion with tea at Kennin-ji and lunch at Nishiki.",
      placeIds: ["x", "y", "z"],
      vibeTags: ["culture", "foodie"],
    });
    const enriched = [
      poi("x", "activity"),
      poi("y", "activity"),
      poi("z", "restaurant"),
    ];

    (searchRoutesByVibe as unknown as { mockResolvedValueOnce: (v: unknown) => void }).mockResolvedValueOnce([route]);
    (composeFromRoutes as unknown as { mockReturnValueOnce: (v: unknown) => void }).mockReturnValueOnce({
      coveredDays: new Map([[1, route]]),
      uncoveredDays: [],
      usedPlaceIds: new Set(["x", "y", "z"]),
    });
    (loadPoisByIds as unknown as { mockResolvedValueOnce: (v: unknown) => void }).mockResolvedValueOnce(enriched);
    (searchPoisByVibe as unknown as { mockResolvedValueOnce: (v: unknown) => void }).mockResolvedValueOnce([]);
    (enrichWithLiveData as unknown as { mockResolvedValueOnce: (v: unknown) => void }).mockResolvedValueOnce(enriched);

    // Restaurant naturally lands at ~12:20 in [activity, activity, restaurant]
    // order from a 09:00 start (90 + 10 + 90 + 10 = 200 min) — inside the
    // lunch window. No opening-hours override needed; the empty periods array
    // means "unknown, treat as unconstrained."

    const { rpc } = mockDbHappyPath();

    const out = await runGenerationPipeline({
      authorLineUserId: "U_route",
      answers: {
        destination: "Kyoto",
        duration_days: 1,
        party: "couple",
        party_size: 2,
        budget_tier: "mid",
        vibe: ["culture"],
        pace: "balanced",
      },
    });

    expect(out.templateId).toBe("tmpl_1");
    expect(generateJson).not.toHaveBeenCalled(); // no LLM pick when all days route-covered
    expect(rpc).toHaveBeenCalledWith("bump_route_quality", {
      p_route_ids: ["r1"],
      p_delta: 1,
    });
  });

  it("calls the LLM only for uncovered days when coverage is partial", async () => {
    const route = makeRoute({ routeId: "r1", placeIds: ["x", "y", "z"] });
    const routePois = [poi("x", "activity"), poi("y", "activity"), poi("z", "restaurant")];
    const poiPool = [poi("a", "activity"), poi("b", "activity"), poi("c", "restaurant")];

    // Route covers day 1; LLM picks for day 2.
    (searchRoutesByVibe as unknown as { mockResolvedValueOnce: (v: unknown) => void }).mockResolvedValueOnce([route]);
    (composeFromRoutes as unknown as { mockReturnValueOnce: (v: unknown) => void }).mockReturnValueOnce({
      coveredDays: new Map([[1, route]]),
      uncoveredDays: [2],
      usedPlaceIds: new Set(["x", "y", "z"]),
    });
    (loadPoisByIds as unknown as { mockResolvedValueOnce: (v: unknown) => void }).mockResolvedValueOnce(routePois);
    (searchPoisByVibe as unknown as { mockResolvedValueOnce: (v: unknown) => void }).mockResolvedValueOnce(poiPool);
    const allEnriched = [...routePois, ...poiPool];
    (enrichWithLiveData as unknown as { mockResolvedValueOnce: (v: unknown) => void }).mockResolvedValueOnce(allEnriched);

    // Restaurants z (day 1) and c (day 2) naturally land at ~12:20 in lunch
    // window for [activity, activity, restaurant] sequences. Leaving the
    // openingPeriods empty exercises the "unknown hours = unconstrained" path.

    (generateJson as unknown as { mockResolvedValueOnce: (v: unknown) => void }).mockResolvedValueOnce({
      title: "Two-day Kyoto",
      summary: "Day one routed, day two picked.",
      tags: ["culture"],
      days: [{ day_number: 2, place_ids: ["a", "b", "c"] }],
    });

    mockDbHappyPath();

    await runGenerationPipeline({
      authorLineUserId: "U_partial",
      answers: {
        destination: "Kyoto",
        duration_days: 2,
        party: "couple",
        party_size: 2,
        budget_tier: "mid",
        vibe: ["culture"],
        pace: "balanced",
      },
    });

    expect(generateJson).toHaveBeenCalledTimes(1);
    // Verify the LLM prompt told the model to pick for day 2 only.
    const callArgs = (generateJson as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    const systemPrompt = String(callArgs[0]);
    expect(systemPrompt).toContain("本次僅需安排以下天數");
    expect(systemPrompt).toContain("2");
    // And the route-reserved place_ids are absent from the shortlist payload.
    const userPayload = JSON.parse(String(callArgs[1])) as { shortlist: Array<{ place_id: string }> };
    const shortlistIds = new Set(userPayload.shortlist.map((s) => s.place_id));
    expect(shortlistIds.has("x")).toBe(false);
    expect(shortlistIds.has("y")).toBe(false);
    expect(shortlistIds.has("z")).toBe(false);
    expect(shortlistIds.has("a")).toBe(true);
  });
});

describe("orchestrator — pace cap enforcement", () => {
  it("silently truncates an over-cap LLM pick to the pace cap", async () => {
    // Chill cap = 3. LLM returns 5; the orchestrator must slice to 3 so the
    // solver never sees too_many_stops.
    const shortlist = Array.from({ length: 5 }, (_, i) => poi(`p${i}`, "activity"));
    (searchPoisByVibe as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue(shortlist);
    (enrichWithLiveData as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue(shortlist);

    (generateJson as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
      title: "over-packed",
      summary: "the LLM didn't read the cap",
      tags: [],
      days: [{ day_number: 1, place_ids: shortlist.map((p) => p.placeId) }],
    });

    const fromBuilder: Record<string, unknown> = {};
    const insertedItems: Array<{ day_number: number; order_index: number }> = [];
    fromBuilder.trip_template_items = {
      insert: vi.fn((rows: Array<{ day_number: number; order_index: number }>) => {
        insertedItems.push(...rows);
        return Promise.resolve({ error: null });
      }),
    };
    const tmplSingle = vi.fn();
    tmplSingle.mockResolvedValueOnce({ data: { id: "tmpl_1" }, error: null });
    const verSingle = vi.fn();
    verSingle.mockResolvedValueOnce({ data: { id: "ver_1" }, error: null });
    const tmplInsert = vi.fn(() => ({ select: vi.fn(() => ({ single: tmplSingle })) }));
    const verInsert = vi.fn(() => ({ select: vi.fn(() => ({ single: verSingle })) }));
    fromBuilder.trip_templates = { insert: tmplInsert, update: vi.fn(() => ({ eq: vi.fn() })) };
    fromBuilder.trip_template_versions = { insert: verInsert };
    const from = vi.fn((table: string) => fromBuilder[table] ?? {});
    const rpc = vi.fn(() => Promise.resolve({ error: null }));
    (createAdminClient as unknown as { mockReturnValue: (v: unknown) => void }).mockReturnValue({ from, rpc });

    await runGenerationPipeline({
      authorLineUserId: "U_cap",
      answers: {
        destination: "Kyoto",
        duration_days: 1,
        party: "solo",
        party_size: 1,
        budget_tier: "mid",
        pace: "chill",
      },
    });

    expect(insertedItems.length).toBe(3); // capped to chill = 3
  });
});

describe("orchestrator — start-date weekday threading", () => {
  it("derives the start weekday from the provided startDate", async () => {
    // 2026-06-13 is a Saturday → weekday 6. POI is closed Saturday but open
    // Monday–Friday: solver should fail on weekday 6.
    const a = poi("a", "activity");
    a.live!.openingPeriods = Array.from({ length: 5 }, (_, i) => ({
      openDay: i + 1,
      openMinutes: 9 * 60,
      closeDay: i + 1,
      closeMinutes: 18 * 60,
    }));
    (searchPoisByVibe as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue([a]);
    (enrichWithLiveData as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue([a]);

    (generateJson as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
      title: "saturday plan",
      summary: "should fail because a is closed saturdays",
      tags: [],
      days: [{ day_number: 1, place_ids: ["a"] }],
    });

    await expect(
      runGenerationPipeline({
        authorLineUserId: "U_sat",
        startDate: "2026-06-13",
        answers: {
          destination: "Kyoto",
          duration_days: 1,
          party: "solo",
          party_size: 1,
          budget_tier: "mid",
          pace: "chill",
        },
      })
    ).rejects.toMatchObject({ reason: "irreparable" });
  });
});

describe("orchestrator — demotion bonus", () => {
  it("does not burn a retry when only a route-covered day fails", async () => {
    // Route covers day 1 with a POI that's closed today. Solver fails on
    // day 1; demote moves it to uncovered. Without the bonus this would
    // consume one of the two retries before the LLM ever picks for day 1.
    const closedToday: EnrichedPoi = {
      ...poi("x", "activity"),
      live: {
        placeId: "x",
        name: null,
        address: null,
        rating: null,
        priceLevel: null,
        lat: 35.0,
        lng: 139.0,
        openingPeriods: Array.from({ length: 5 }, (_, i) => ({
          openDay: i + 1, // Mon–Fri only
          openMinutes: 9 * 60,
          closeDay: i + 1,
          closeMinutes: 18 * 60,
        })),
      },
    };
    const route = makeRoute({
      routeId: "r1",
      placeIds: ["x"],
    });
    const pool = [poi("a", "activity")];

    (searchRoutesByVibe as unknown as { mockResolvedValueOnce: (v: unknown) => void }).mockResolvedValueOnce([route]);
    (composeFromRoutes as unknown as { mockReturnValueOnce: (v: unknown) => void }).mockReturnValueOnce({
      coveredDays: new Map([[1, route]]),
      uncoveredDays: [],
      usedPlaceIds: new Set(["x"]),
    });
    (loadPoisByIds as unknown as { mockResolvedValueOnce: (v: unknown) => void }).mockResolvedValueOnce([closedToday]);
    (searchPoisByVibe as unknown as { mockResolvedValueOnce: (v: unknown) => void }).mockResolvedValueOnce(pool);
    (enrichWithLiveData as unknown as { mockResolvedValueOnce: (v: unknown) => void }).mockResolvedValueOnce([
      closedToday,
      ...pool,
    ]);

    (generateJson as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
      title: "after demote",
      summary: "LLM rescues day 1",
      tags: [],
      days: [{ day_number: 1, place_ids: ["a"] }],
    });

    mockDbHappyPath();

    // Trip on a Saturday (weekday 6) so the route POI is closed.
    const out = await runGenerationPipeline({
      authorLineUserId: "U_demote",
      startDate: "2026-06-13",
      answers: {
        destination: "Kyoto",
        duration_days: 1,
        party: "solo",
        party_size: 1,
        budget_tier: "mid",
        pace: "chill",
      },
    });
    expect(out.templateId).toBe("tmpl_1");
    // Attempt 0 = route preordered (fails → demote). Attempt 1 = LLM picks
    // for day 1 (succeeds). That's one LLM call.
    expect(generateJson).toHaveBeenCalledTimes(1);
  });
});

describe("orchestrator — repair loop", () => {
  it("retries when solver reports infeasibility, then gives up", async () => {
    // Every candidate is missing coords — solver will always return no_coords
    // for whatever the LLM picks, exercising the full repair budget.
    const shortlist = Array.from({ length: 3 }, (_, i) => {
      const p = poi(`p${i}`, "activity");
      (p as { lat: number | null }).lat = null;
      (p as { lng: number | null }).lng = null;
      if (p.live) {
        p.live.lat = null;
        p.live.lng = null;
      }
      return p;
    });
    (searchPoisByVibe as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue(shortlist);
    (enrichWithLiveData as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue(shortlist);

    (generateJson as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
      title: "no-coord stress",
      summary: "stress test for the repair loop",
      tags: [],
      days: [{ day_number: 1, place_ids: shortlist.map((p) => p.placeId) }],
    });

    await expect(
      runGenerationPipeline({
        authorLineUserId: "U",
        answers: {
          destination: "Kyoto",
          duration_days: 1,
          party: "solo",
          party_size: 1,
          budget_tier: "mid",
          pace: "chill",
        },
      })
    ).rejects.toMatchObject({ reason: "irreparable" });

    // Initial attempt + 2 repairs = 3 LLM calls. No route demotion happens
    // (no routes in the test), so the demotion bonus doesn't kick in.
    expect(generateJson).toHaveBeenCalledTimes(3);
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

// All collaborators are mocked at module load — these are pure unit tests of
// the orchestrator's control flow (pick → solve → repair → persist).

vi.mock("@/services/trip-generation/poi-engine", () => ({
  searchPoisByVibe: vi.fn(),
  enrichWithLiveData: vi.fn(),
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
import { generateJson } from "@/lib/gemini";
import { createAdminClient } from "@/lib/db";
import { GenerationFailedError } from "@/services/trip-generation/orchestrator";
import type { EnrichedPoi } from "@/services/trip-generation/poi-engine";

function poi(id: string, type: EnrichedPoi["itemType"] = "activity"): EnrichedPoi {
  return {
    placeId: id,
    name: `Place ${id}`,
    itemType: type,
    tags: [],
    description: `${id} description`,
    lat: 35 + Math.random() * 0.01,
    lng: 139 + Math.random() * 0.01,
    similarity: 0.9,
    live: {
      placeId: id,
      name: `Place ${id}`,
      address: "addr",
      rating: 4.2,
      priceLevel: "$$",
      lat: 35,
      lng: 139,
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
  (createAdminClient as unknown as { mockReturnValue: (v: unknown) => void }).mockReturnValue({ from });
  return { from };
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

describe("orchestrator — repair loop", () => {
  it("retries when solver reports infeasibility, then gives up", async () => {
    // 5 stops with chill cap (3) → always too_many_stops on day 1.
    const shortlist = Array.from({ length: 5 }, (_, i) => poi(`p${i}`, "activity"));
    (searchPoisByVibe as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue(shortlist);
    (enrichWithLiveData as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue(shortlist);

    // Always over-pack day 1 to force repair-then-irreparable.
    (generateJson as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
      title: "over-packed",
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

    // Initial attempt + 2 repairs = 3 LLM calls.
    expect(generateJson).toHaveBeenCalledTimes(3);
  });
});

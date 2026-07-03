import { describe, it, expect, vi, beforeEach } from "vitest";

const completeJsonMock = vi.fn();
vi.mock("@/lib/llm", () => ({
  completeJson: (...args: unknown[]) => completeJsonMock(...args),
}));

import {
  buildItineraryRubric,
  renderItineraryForJudge,
  judgeItinerary,
  type JudgeItineraryInput,
} from "@/services/trip-generation/benchmark-judge";

function judgeInput(): JudgeItineraryInput {
  return {
    destination: "Niseko, Japan",
    title: "Powder & Onsen Escape",
    summary: "Four days of skiing and soaking.",
    input: {
      answers: {
        duration_days: 2,
        pace: "chill",
        party: "couple",
        budget_tier: "luxury",
        vibe: ["relaxed", "nature"],
        must_haves: "onsen",
      },
      days: [
        {
          dayNumber: 1,
          stops: [
            {
              placeId: "p1",
              name: "Grand Hirafu",
              itemType: "activity",
              tags: ["ski_resort"],
              lat: 42.86,
              lng: 140.7,
              arriveMinutes: 540,
              departMinutes: 690,
            },
            {
              placeId: "p2",
              name: "Onsen Ryokan",
              itemType: "restaurant",
              tags: [],
              lat: 42.86,
              lng: 140.71,
              arriveMinutes: 750,
              departMinutes: 825,
            },
          ],
        },
        { dayNumber: 2, stops: [] },
      ],
    },
  };
}

describe("buildItineraryRubric", () => {
  it("embeds the traveler profile and the four aspects", () => {
    const rubric = buildItineraryRubric(judgeInput());
    expect(rubric).toContain("Niseko, Japan");
    expect(rubric).toContain("2 days, pace: chill");
    expect(rubric).toContain("relaxed, nature");
    expect(rubric).toContain("onsen");
    for (const aspect of ["day_coherence", "personalization", "realism", "title_summary_quality"]) {
      expect(rubric).toContain(aspect);
    }
  });

  it("degrades gracefully when answers are sparse", () => {
    const rubric = buildItineraryRubric({
      input: { answers: { duration_days: 3, pace: "balanced" }, days: [] },
    });
    expect(rubric).toContain("(unspecified)");
    expect(rubric).toContain("(none specified)");
    expect(rubric).toContain("(none)");
  });
});

describe("renderItineraryForJudge", () => {
  it("renders title, timed stops, tags and empty days", () => {
    const out = renderItineraryForJudge(judgeInput());
    expect(out).toContain("Title: Powder & Onsen Escape");
    expect(out).toContain("Summary: Four days of skiing and soaking.");
    expect(out).toContain("Day 1:");
    expect(out).toContain("09:00–11:30 Grand Hirafu [activity: ski_resort]");
    expect(out).toContain("12:30–13:45 Onsen Ryokan [restaurant]");
    expect(out).toContain("Day 2: (empty)");
  });

  it("orders days by dayNumber regardless of input order", () => {
    const input = judgeInput();
    input.input.days.reverse();
    const out = renderItineraryForJudge(input);
    expect(out.indexOf("Day 1:")).toBeLessThan(out.indexOf("Day 2:"));
  });
});

describe("judgeItinerary", () => {
  beforeEach(() => {
    completeJsonMock.mockReset();
  });

  it("sends rubric + rendered itinerary through lib/llm and returns the verdict", async () => {
    const verdict = {
      pass: true,
      score: 0.8,
      reasoning: "Coherent ski days; strong onsen fit.",
      aspects: {
        day_coherence: 0.9,
        personalization: 0.8,
        realism: 0.8,
        title_summary_quality: 0.7,
      },
    };
    completeJsonMock.mockResolvedValue(verdict);

    const result = await judgeItinerary(judgeInput());
    expect(result).toEqual(verdict);

    const [prompt, opts] = completeJsonMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(prompt).toContain("Rubric:");
    expect(prompt).toContain("Itinerary to judge:");
    expect(prompt).toContain("Grand Hirafu");
    expect(opts.taskClass).toBe("other");
    expect(opts.schema).toBeDefined();
    expect((opts.metadata as Record<string, unknown>).role).toBe("itinerary_benchmark_judge");
  });
});

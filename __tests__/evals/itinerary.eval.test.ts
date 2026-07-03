/**
 * Itinerary benchmark eval — scores golden/flawed itinerary fixtures with the
 * deterministic scorer in services/trip-generation/benchmark.ts.
 *
 * Unlike the orchestrator/parsing evals this needs no LLM and no live mode:
 * scoring is pure, so the thresholds are a real regression gate on every
 * push. Golden fixtures assert `min_score` (a good plan must keep scoring
 * well); flawed fixtures assert `max_score` (the scorer must keep catching
 * the planted defects).
 *
 * With RUN_LIVE_EVALS=1 golden fixtures additionally go through the
 * LLM-as-judge (services/trip-generation/benchmark-judge.ts) for the
 * subjective qualities rules can't measure — day coherence,
 * personalization, realism.
 *
 * Live end-to-end runs (real pipeline → real score + judge) live in
 * scripts/benchmark-itinerary.ts, which appends to benchmarks/history.jsonl.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isLive } from "./harness";
import {
  scoreItinerary,
  METRIC_WEIGHTS,
  type BenchmarkInput,
} from "@/services/trip-generation/benchmark";
import { judgeItinerary } from "@/services/trip-generation/benchmark-judge";

interface ItineraryFixture {
  id: string;
  task_class: string;
  input: BenchmarkInput;
  expect: {
    min_score?: number;
    max_score?: number;
  };
}

function loadItineraryFixtures(): ItineraryFixture[] {
  const dir = join(process.cwd(), "__tests__", "evals", "fixtures", "itinerary");
  return readdirSync(dir)
    .filter((e) => e.endsWith(".json"))
    .map((e) => JSON.parse(readFileSync(join(dir, e), "utf8")) as ItineraryFixture);
}

describe("evals/itinerary", () => {
  const fixtures = loadItineraryFixtures();

  it("has at least one golden and one flawed fixture", () => {
    expect(fixtures.some((f) => f.expect.min_score != null)).toBe(true);
    expect(fixtures.some((f) => f.expect.max_score != null)).toBe(true);
  });

  it("metric weights sum to 1", () => {
    const sum = Object.values(METRIC_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 6);
  });

  for (const fx of fixtures) {
    it(fx.id, async () => {
      expect(fx.task_class).toBe("itinerary");
      expect(
        fx.expect.min_score != null || fx.expect.max_score != null,
        "fixture must declare min_score and/or max_score"
      ).toBe(true);

      const report = scoreItinerary(fx.input);
      const summary = report.metrics
        .map((m) => `${m.id}=${(m.score * 100).toFixed(0)} (${m.detail})`)
        .join("; ");

      expect(report.total).toBeGreaterThanOrEqual(0);
      expect(report.total).toBeLessThanOrEqual(100);
      if (fx.expect.min_score != null) {
        expect(report.total, `score ${report.total} below floor — ${summary}`).toBeGreaterThanOrEqual(
          fx.expect.min_score
        );
      }
      if (fx.expect.max_score != null) {
        expect(report.total, `score ${report.total} above ceiling — ${summary}`).toBeLessThanOrEqual(
          fx.expect.max_score
        );
      }

      // Subjective pass — golden fixtures only, live mode only. Flawed
      // fixtures stay the deterministic scorer's job; asking an LLM to
      // grade a deliberately broken plan invites flaky thresholds.
      if (isLive() && fx.expect.min_score != null) {
        const verdict = await judgeItinerary({ input: fx.input });
        expect(verdict.pass, `judge failed golden fixture: ${verdict.reasoning}`).toBe(true);
      }
    });
  }
});

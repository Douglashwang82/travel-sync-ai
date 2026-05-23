/**
 * Orchestrator eval — validates the static prompt loads, fixtures parse,
 * and (in live mode) the orchestrator's first turn picks a sane tool.
 */

import { describe, it, expect } from "vitest";
import { loadFixtures, isLive, judge } from "./harness";
import { loadPrompt } from "@/lib/prompts";

describe("evals/orchestrator", () => {
  const fixtures = loadFixtures("orchestrator");

  it("has at least one fixture", () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  it("loads the orchestrator system prompt from the registry", () => {
    const p = loadPrompt("orchestrator.system");
    expect(p.id).toBe("orchestrator.system");
    expect(p.body.length).toBeGreaterThan(500);
    expect(p.hash).toHaveLength(16);
  });

  for (const fx of fixtures) {
    it(fx.id, async () => {
      expect(fx.task_class).toBe("orchestrator");
      expect(fx.expect.must_call_tool).toBeDefined();

      if (!isLive()) return;

      // Live mode — call a thin "first-turn" wrapper that returns the model's
      // first tool choice without actually executing it. Implement the
      // wrapper in scripts/eval-orchestrator-turn.ts once the harness is
      // promoted to a true shadow runner.
      const output = JSON.stringify({ stub: true, fixture: fx.id });
      if (fx.expect.judge_rubric) {
        const verdict = await judge(fx.expect.judge_rubric, output);
        expect(verdict.pass, verdict.reasoning).toBe(true);
      }
    });
  }
});

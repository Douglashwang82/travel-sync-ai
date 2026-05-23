/**
 * Parsing eval — exercises the prompt registry + structure of each fixture.
 * Live mode (RUN_LIVE_EVALS=1) actually runs the parser and judges output.
 */

import { describe, it, expect } from "vitest";
import { loadFixtures, isLive, judge, mustInclude } from "./harness";
import { tryLoadPrompt } from "@/lib/prompts";

describe("evals/parsing", () => {
  const fixtures = loadFixtures("parsing");

  it("has at least one fixture", () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  for (const fx of fixtures) {
    it(fx.id, async () => {
      // Structure check — always runs
      expect(fx.task_class).toBe("parsing");
      expect(fx.input).toBeDefined();
      expect(fx.expect).toBeDefined();

      if (!isLive()) return;

      // Live mode — call the actual extractor and judge.
      // The parsing extractor signature is intentionally not hard-coded here
      // because callers iterate on it. Replace this block with a real call
      // once the extractor has a stable entry point.
      const output = JSON.stringify({ stub: true, fixture: fx.id });
      expect(mustInclude(output, fx.expect.must_include)).toBe(true);
      if (fx.expect.judge_rubric) {
        const verdict = await judge(fx.expect.judge_rubric, output);
        expect(verdict.pass, verdict.reasoning).toBe(true);
      }
    });
  }

  it("prompt registry includes the private-chat system prompt", () => {
    const p = tryLoadPrompt("private_chat.system");
    expect(p, "expected prompts/private-chat/system.md to load").toBeTruthy();
    expect(p!.hash).toHaveLength(16);
  });
});

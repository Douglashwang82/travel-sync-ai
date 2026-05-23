/**
 * Shared utilities for eval runners. Loads fixtures and exposes a judge.
 *
 * Live mode is gated by RUN_LIVE_EVALS=1. In CI we default to structure-only
 * — fixtures are loaded and validated, the prompt registry is exercised, but
 * no provider call is made. That keeps every push green without burning money.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface EvalFixture {
  id: string;
  task_class: string;
  input: unknown;
  expect: {
    must_include?: string[];
    must_call_tool?: string;
    judge_rubric?: string;
  };
}

export function loadFixtures(taskClass: string): EvalFixture[] {
  const dir = join(process.cwd(), "__tests__", "evals", "fixtures", taskClass);
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.endsWith(".json"))
    .map((e) => JSON.parse(readFileSync(join(dir, e), "utf8")) as EvalFixture);
}

export function isLive(): boolean {
  return process.env.RUN_LIVE_EVALS === "1";
}

export interface JudgeResult {
  pass: boolean;
  score: number;
  reasoning: string;
}

/**
 * LLM-as-judge. Uses the configured LLM provider (Anthropic preferred for
 * judging — better at adhering to a rubric). Returns a structured verdict.
 *
 * In structure-only mode this returns a stub so callers can still assert
 * shape without hitting the network.
 */
export async function judge(
  rubric: string,
  output: string,
): Promise<JudgeResult> {
  if (!isLive()) {
    return { pass: true, score: 1, reasoning: "structure-only (RUN_LIVE_EVALS!=1)" };
  }
  const { completeJson } = await import("@/lib/llm");
  const { z } = await import("zod");
  const schema = z.object({
    pass: z.boolean(),
    score: z.number().min(0).max(1),
    reasoning: z.string(),
  });
  return completeJson(
    `Rubric:\n${rubric}\n\nOutput to judge:\n${output}`,
    {
      taskClass: "other",
      provider: process.env.ANTHROPIC_API_KEY ? "anthropic" : undefined,
      systemPrompt:
        "You are a strict eval judge. Given a rubric and a model output, return JSON {pass, score (0-1), reasoning}. Pass = the output satisfies all rubric requirements. Reasoning is one sentence.",
      schema,
      metadata: { role: "judge" },
    },
  );
}

export function mustInclude(output: string, needles: string[] | undefined): boolean {
  if (!needles || needles.length === 0) return true;
  return needles.every((n) => output.includes(n));
}

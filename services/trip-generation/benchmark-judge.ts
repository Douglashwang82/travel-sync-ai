// ─────────────────────────────────────────────────────────────────────────────
// Itinerary benchmark — LLM-as-judge layer.
//
// The deterministic scorer (./benchmark.ts) measures what rules can measure:
// coverage, pace, meals, travel, diversity. This module covers what they
// can't — does the plan read like a coherent trip a human would enjoy? Day
// theming, personalization to the survey answers, realism, and title/summary
// quality are graded by an LLM against a rubric built from the same answers.
//
// Costs a provider call, so nothing here runs in plain `npm test`:
//   • scripts/benchmark-itinerary.ts judges live runs by default (--no-judge
//     to skip) and appends the verdict to benchmarks/history.jsonl.
//   • __tests__/evals/itinerary.eval.test.ts judges golden fixtures only
//     when RUN_LIVE_EVALS=1, same convention as the other evals.
//
// Routed through lib/llm (never a provider SDK directly). Anthropic is
// preferred when available — same reasoning as __tests__/evals/harness.ts:
// it adheres to rubrics better.
// ─────────────────────────────────────────────────────────────────────────────

import { z } from "zod";
import { completeJson } from "@/lib/llm";
import type { BenchmarkInput } from "./benchmark";

// ─── Verdict shape ──────────────────────────────────────────────────────────

export const ItineraryJudgeSchema = z.object({
  pass: z.boolean(),
  /** Overall 0–1. */
  score: z.number().min(0).max(1),
  reasoning: z.string(),
  aspects: z.object({
    day_coherence: z.number().min(0).max(1),
    personalization: z.number().min(0).max(1),
    realism: z.number().min(0).max(1),
    title_summary_quality: z.number().min(0).max(1),
  }),
});
export type ItineraryJudgeResult = z.infer<typeof ItineraryJudgeSchema>;

export interface JudgeItineraryInput {
  input: BenchmarkInput;
  /** Template title/summary when available (live runs); judged when present. */
  title?: string | null;
  summary?: string | null;
  destination?: string | null;
}

// ─── Rubric + rendering (pure, unit-tested) ─────────────────────────────────

export function buildItineraryRubric(input: JudgeItineraryInput): string {
  const a = input.input.answers;
  const lines = [
    "Judge this generated travel itinerary as a demanding travel editor. Grade four aspects, each 0–1:",
    "1) day_coherence — each day reads as a sensible arc (morning → lunch → afternoon → dinner), stops on the same day belong together thematically or geographically, and the trip has a progression rather than a random shuffle.",
    "2) personalization — the plan visibly reflects the traveler profile below, not a generic city top-10.",
    "3) realism — timings, sequencing and stop mix are plausible to actually execute; no obviously redundant or filler stops.",
    "4) title_summary_quality — when a title/summary is provided, it is specific to this plan, accurate, and inviting (not boilerplate). When absent, grade this aspect 0.5 (neutral).",
    "",
    "Traveler profile:",
    `- Destination: ${input.destination ?? "(unspecified)"}`,
    `- Duration: ${a.duration_days ?? "?"} days, pace: ${a.pace ?? "balanced"}`,
    `- Party: ${a.party ?? "?"}${a.budget_tier ? `, budget: ${a.budget_tier}` : ""}`,
    `- Vibes: ${(a.vibe ?? []).join(", ") || "(none specified)"}`,
    `- Must-haves: ${a.must_haves || "(none)"}`,
    "",
    "Return JSON { pass, score, reasoning, aspects: { day_coherence, personalization, realism, title_summary_quality } }.",
    "score is the overall 0–1 grade (weigh the four aspects evenly). pass = score ≥ 0.6 AND no aspect below 0.3.",
    "reasoning: 1–3 sentences naming the strongest and weakest aspect. Do not reward length or flowery names; judge the plan.",
  ];
  return lines.join("\n");
}

export function renderItineraryForJudge(input: JudgeItineraryInput): string {
  const parts: string[] = [];
  if (input.title) parts.push(`Title: ${input.title}`);
  if (input.summary) parts.push(`Summary: ${input.summary}`);
  for (const day of [...input.input.days].sort((x, y) => x.dayNumber - y.dayNumber)) {
    if (day.stops.length === 0) {
      parts.push(`Day ${day.dayNumber}: (empty)`);
      continue;
    }
    const stops = day.stops
      .map(
        (s) =>
          `  ${fmt(s.arriveMinutes)}–${fmt(s.departMinutes)} ${s.name} [${s.itemType}${
            s.tags.length ? `: ${s.tags.join(", ")}` : ""
          }]`
      )
      .join("\n");
    parts.push(`Day ${day.dayNumber}:\n${stops}`);
  }
  return parts.join("\n");
}

function fmt(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

// ─── Judge call ─────────────────────────────────────────────────────────────

export async function judgeItinerary(
  judgeInput: JudgeItineraryInput
): Promise<ItineraryJudgeResult> {
  return completeJson(
    `Rubric:\n${buildItineraryRubric(judgeInput)}\n\nItinerary to judge:\n${renderItineraryForJudge(judgeInput)}`,
    {
      taskClass: "other",
      provider: process.env.ANTHROPIC_API_KEY ? "anthropic" : undefined,
      systemPrompt:
        "You are a strict itinerary-quality judge. Given a rubric and an itinerary, return only the JSON verdict the rubric describes. Be calibrated: 0.9+ is rare, 0.6 is a solid plan, 0.3 is barely usable.",
      schema: ItineraryJudgeSchema,
      metadata: { role: "itinerary_benchmark_judge" },
    }
  );
}

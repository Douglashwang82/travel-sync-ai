/**
 * Live itinerary benchmark — runs the real generation pipeline for the
 * scenarios in benchmarks/scenarios.json, scores what actually got persisted
 * (trip_template_items read back from the DB, i.e. exactly what a user would
 * receive), and appends one JSONL row per scenario to benchmarks/history.jsonl
 * so score trends survive across generator changes.
 *
 * The deterministic scorer lives in services/trip-generation/benchmark.ts;
 * the offline regression gate on the same scorer is
 * __tests__/evals/itinerary.eval.test.ts.
 *
 * Run:
 *   npm run benchmark:itinerary
 *   npx tsx --env-file=.env.local scripts/benchmark-itinerary.ts --scenario niseko-4d-friends-powder
 *   npx tsx --env-file=.env.local scripts/benchmark-itinerary.ts --no-history
 *
 * Flags:
 *   --scenario <id>   Run a single scenario instead of all.
 *   --no-history      Print reports only; skip the history.jsonl append.
 *   --no-judge        Skip the LLM-as-judge pass (deterministic metrics only).
 *
 * Costs real Gemini calls and writes real (private) trip_templates authored
 * by `benchmark-runner`, so this is an on-demand tool, not a cron.
 */

import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { execSync } from "node:child_process";
import { z } from "zod";
import { createAdminClient } from "@/lib/db";
import { runGenerationPipeline, GenerationFailedError } from "@/services/trip-generation/orchestrator";
import {
  scoreItinerary,
  benchmarkInputFromTemplateItems,
  formatBenchmarkReport,
  type TemplateItemRow,
} from "@/services/trip-generation/benchmark";
import { judgeItinerary } from "@/services/trip-generation/benchmark-judge";

const BENCHMARK_AUTHOR = "benchmark-runner";
const SCENARIOS_PATH = path.join(process.cwd(), "benchmarks", "scenarios.json");
const HISTORY_PATH = path.join(process.cwd(), "benchmarks", "history.jsonl");

const ScenarioSchema = z.object({
  id: z.string().min(1),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  answers: z.object({
    destination: z.string().min(1),
    duration_days: z.number().int().min(1).max(30),
    party: z.enum(["solo", "couple", "family", "friends"]),
    party_size: z.number().int().min(1),
    budget_tier: z.enum(["shoestring", "mid", "luxury"]),
    vibe: z.array(z.enum(["relaxed", "adventure", "culture", "foodie", "nightlife", "nature"])).optional(),
    pace: z.enum(["chill", "balanced", "packed"]),
    must_haves: z.string().nullable().optional(),
  }),
});
type Scenario = z.infer<typeof ScenarioSchema>;

function gitRev(): string | null {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

async function loadScenarios(): Promise<Scenario[]> {
  const raw = JSON.parse(await readFile(SCENARIOS_PATH, "utf8"));
  return z.array(ScenarioSchema).parse(raw);
}

async function loadTemplateItems(versionId: string): Promise<TemplateItemRow[]> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("trip_template_items")
    .select("day_number, order_index, item_type, title, notes, lat, lng, duration_minutes")
    .eq("version_id", versionId)
    .order("day_number")
    .order("order_index");
  if (error) throw new Error(`failed to load template items: ${error.message}`);
  return (data ?? []) as TemplateItemRow[];
}

async function loadTemplateVersion(
  versionId: string
): Promise<{ title: string | null; summary: string | null }> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("trip_template_versions")
    .select("title, summary")
    .eq("id", versionId)
    .single();
  if (error || !data) return { title: null, summary: null };
  return { title: data.title as string | null, summary: data.summary as string | null };
}

async function main() {
  const args = process.argv.slice(2);
  const onlyIdx = args.indexOf("--scenario");
  const onlyId = onlyIdx >= 0 ? args[onlyIdx + 1] : null;
  const writeHistory = !args.includes("--no-history");
  const runJudge = !args.includes("--no-judge");

  const all = await loadScenarios();
  const scenarios = onlyId ? all.filter((s) => s.id === onlyId) : all;
  if (scenarios.length === 0) {
    console.error(onlyId ? `no scenario with id '${onlyId}'` : "no scenarios defined");
    process.exit(1);
  }

  const rev = gitRev();
  const ranAt = new Date().toISOString();
  const rows: Array<Record<string, unknown>> = [];
  let failures = 0;

  for (const scenario of scenarios) {
    console.log(`\n━━ ${scenario.id} — ${scenario.answers.destination}, ${scenario.answers.duration_days}d ${scenario.answers.pace} ━━`);
    const t0 = Date.now();
    try {
      const out = await runGenerationPipeline({
        answers: scenario.answers,
        authorLineUserId: BENCHMARK_AUTHOR,
        startDate: scenario.startDate,
      });
      const items = await loadTemplateItems(out.versionId);
      const benchmarkInput = benchmarkInputFromTemplateItems(scenario.answers, items);
      const report = scoreItinerary(benchmarkInput);
      console.log(formatBenchmarkReport(report));

      // Subjective quality pass — non-fatal: a judge outage shouldn't lose
      // the deterministic row.
      let verdict: Record<string, unknown> | null = null;
      if (runJudge) {
        try {
          const { title, summary } = await loadTemplateVersion(out.versionId);
          const j = await judgeItinerary({
            input: benchmarkInput,
            title,
            summary,
            destination: scenario.answers.destination,
          });
          verdict = {
            pass: j.pass,
            score: Math.round(j.score * 100) / 100,
            aspects: Object.fromEntries(
              Object.entries(j.aspects).map(([k, v]) => [k, Math.round(v * 100) / 100])
            ),
            reasoning: j.reasoning,
          };
          console.log(
            `  judge: ${j.pass ? "PASS" : "FAIL"} ${(j.score * 100).toFixed(0)}/100 ` +
              `(coherence=${(j.aspects.day_coherence * 100).toFixed(0)} ` +
              `personalization=${(j.aspects.personalization * 100).toFixed(0)} ` +
              `realism=${(j.aspects.realism * 100).toFixed(0)} ` +
              `title=${(j.aspects.title_summary_quality * 100).toFixed(0)}) — ${j.reasoning}`
          );
        } catch (err) {
          console.warn(`  judge skipped (error): ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      console.log(`  templateId=${out.templateId} versionId=${out.versionId} elapsed=${((Date.now() - t0) / 1000).toFixed(1)}s`);
      rows.push({
        ran_at: ranAt,
        git: rev,
        scenario: scenario.id,
        ok: true,
        total: report.total,
        metrics: Object.fromEntries(report.metrics.map((m) => [m.id, Math.round(m.score * 100) / 100])),
        judge: verdict,
        stats: report.stats,
        template_id: out.templateId,
        version_id: out.versionId,
        elapsed_ms: Date.now() - t0,
      });
    } catch (err) {
      failures++;
      const reason = err instanceof GenerationFailedError ? err.reason : "unexpected";
      console.error(`  FAILED (${reason}): ${err instanceof Error ? err.message : String(err)}`);
      rows.push({
        ran_at: ranAt,
        git: rev,
        scenario: scenario.id,
        ok: false,
        failure_reason: reason,
        elapsed_ms: Date.now() - t0,
      });
    }
  }

  if (writeHistory) {
    await mkdir(path.dirname(HISTORY_PATH), { recursive: true });
    await appendFile(HISTORY_PATH, rows.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
    console.log(`\nappended ${rows.length} row(s) to benchmarks/history.jsonl`);
  }

  const scored = rows.filter((r) => r.ok) as Array<{ total: number }>;
  if (scored.length > 0) {
    const mean = scored.reduce((a, r) => a + r.total, 0) / scored.length;
    console.log(`mean score across ${scored.length} scenario(s): ${mean.toFixed(1)} / 100`);
  }
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

// ─────────────────────────────────────────────────────────────────────────────
// Itinerary benchmark — shared live runner.
//
// One code path for "generate → read back what was persisted → score → judge
// → record", used by both entry points:
//
//   • scripts/benchmark-itinerary.ts   (CLI; also appends benchmarks/history.jsonl)
//   • POST /api/app/benchmark/runs     (web UI at /app/benchmark)
//
// Every run — pass or fail — lands as a row in `benchmark_runs`, which is the
// canonical history the web UI charts. Persistence is deliberately non-fatal:
// a missing table or transient DB error downgrades to a warning so the caller
// still gets the scored result.
// ─────────────────────────────────────────────────────────────────────────────

import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { createAdminClient } from "@/lib/db";
import { logger } from "@/lib/logger";
import { runGenerationPipeline, GenerationFailedError } from "./orchestrator";
import {
  scoreItinerary,
  benchmarkInputFromTemplateItems,
  type BenchmarkReport,
  type TemplateItemRow,
} from "./benchmark";
import { judgeItinerary, type ItineraryJudgeResult } from "./benchmark-judge";

/** Author stamped on templates produced by benchmark runs. */
export const BENCHMARK_AUTHOR = "benchmark-runner";

// ─── Scenario schema ────────────────────────────────────────────────────────

export const BenchmarkAnswersSchema = z.object({
  destination: z.string().min(1).max(120),
  duration_days: z.number().int().min(1).max(30),
  party: z.enum(["solo", "couple", "family", "friends"]),
  party_size: z.number().int().min(1).max(20),
  budget_tier: z.enum(["shoestring", "mid", "luxury"]),
  vibe: z
    .array(z.enum(["relaxed", "adventure", "culture", "foodie", "nightlife", "nature"]))
    .optional(),
  pace: z.enum(["chill", "balanced", "packed"]),
  must_haves: z.string().max(500).nullable().optional(),
});
export type BenchmarkAnswers = z.infer<typeof BenchmarkAnswersSchema>;

export const BenchmarkScenarioSchema = z.object({
  id: z.string().min(1).max(80),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  answers: BenchmarkAnswersSchema,
});
export type BenchmarkScenario = z.infer<typeof BenchmarkScenarioSchema>;

const SCENARIOS_PATH = path.join(process.cwd(), "benchmarks", "scenarios.json");

/** Preset scenarios checked into benchmarks/scenarios.json. */
export async function loadPresetScenarios(): Promise<BenchmarkScenario[]> {
  const raw = JSON.parse(await readFile(SCENARIOS_PATH, "utf8"));
  return z.array(BenchmarkScenarioSchema).parse(raw);
}

// ─── Run record ─────────────────────────────────────────────────────────────

export interface BenchmarkJudgeVerdict {
  pass: boolean;
  score: number;
  aspects: Record<string, number>;
  reasoning: string;
}

/** Serializable run row — matches the `benchmark_runs` table shape. */
export interface BenchmarkRunRecord {
  /** DB row id; null when persistence failed or was skipped. */
  id: string | null;
  ran_at: string;
  source: "cli" | "web";
  git_rev: string | null;
  scenario_id: string;
  answers: BenchmarkAnswers;
  start_date: string | null;
  ok: boolean;
  failure_reason: string | null;
  total: number | null;
  metrics: Record<string, number> | null;
  stats: BenchmarkReport["stats"] | null;
  judge: BenchmarkJudgeVerdict | null;
  template_id: string | null;
  version_id: string | null;
  elapsed_ms: number;
  triggered_by: string | null;
}

export interface BenchmarkRunOutcome {
  record: BenchmarkRunRecord;
  /** Full deterministic report (null when generation failed). */
  report: BenchmarkReport | null;
  /** Full judge verdict (null when skipped, failed, or generation failed). */
  verdict: ItineraryJudgeResult | null;
}

export interface RunBenchmarkOptions {
  scenario: BenchmarkScenario;
  source: "cli" | "web";
  /** Run the LLM-as-judge pass (default true). */
  judge?: boolean;
  gitRev?: string | null;
  /** line_user_id of the web user who triggered the run; null for CLI. */
  triggeredBy?: string | null;
  /** Skip the benchmark_runs insert (default false). */
  skipPersist?: boolean;
}

// ─── Runner ─────────────────────────────────────────────────────────────────

export async function runBenchmarkScenario(
  opts: RunBenchmarkOptions
): Promise<BenchmarkRunOutcome> {
  const { scenario } = opts;
  const ranAt = new Date().toISOString();
  const t0 = Date.now();

  const base: Omit<
    BenchmarkRunRecord,
    "ok" | "failure_reason" | "total" | "metrics" | "stats" | "judge" | "template_id" | "version_id" | "elapsed_ms"
  > = {
    id: null,
    ran_at: ranAt,
    source: opts.source,
    git_rev: opts.gitRev ?? null,
    scenario_id: scenario.id,
    answers: scenario.answers,
    start_date: scenario.startDate ?? null,
    triggered_by: opts.triggeredBy ?? null,
  };

  let record: BenchmarkRunRecord;
  let report: BenchmarkReport | null = null;
  let verdict: ItineraryJudgeResult | null = null;

  try {
    const out = await runGenerationPipeline({
      answers: scenario.answers,
      authorLineUserId: BENCHMARK_AUTHOR,
      startDate: scenario.startDate,
    });

    const [items, version] = await Promise.all([
      loadTemplateItems(out.versionId),
      loadTemplateVersion(out.versionId),
    ]);
    const benchmarkInput = benchmarkInputFromTemplateItems(scenario.answers, items);
    report = scoreItinerary(benchmarkInput);

    // Subjective pass — non-fatal: a judge outage shouldn't lose the row.
    if (opts.judge !== false) {
      try {
        verdict = await judgeItinerary({
          input: benchmarkInput,
          title: version.title,
          summary: version.summary,
          destination: scenario.answers.destination,
        });
      } catch (err) {
        logger.warn("[benchmark] judge failed (non-fatal)", {
          scenario: scenario.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    record = {
      ...base,
      ok: true,
      failure_reason: null,
      total: report.total,
      metrics: Object.fromEntries(
        report.metrics.map((m) => [m.id, Math.round(m.score * 100) / 100])
      ),
      stats: report.stats,
      judge: verdict
        ? {
            pass: verdict.pass,
            score: Math.round(verdict.score * 100) / 100,
            aspects: Object.fromEntries(
              Object.entries(verdict.aspects).map(([k, v]) => [k, Math.round(v * 100) / 100])
            ),
            reasoning: verdict.reasoning,
          }
        : null,
      template_id: out.templateId,
      version_id: out.versionId,
      elapsed_ms: Date.now() - t0,
    };
  } catch (err) {
    const reason = err instanceof GenerationFailedError ? err.reason : "unexpected";
    logger.warn("[benchmark] generation failed", {
      scenario: scenario.id,
      reason,
      error: err instanceof Error ? err.message : String(err),
    });
    record = {
      ...base,
      ok: false,
      failure_reason: reason,
      total: null,
      metrics: null,
      stats: null,
      judge: null,
      template_id: null,
      version_id: null,
      elapsed_ms: Date.now() - t0,
    };
  }

  if (!opts.skipPersist) {
    record.id = await persistRun(record);
  }

  return { record, report, verdict };
}

// ─── History reads (used by the web API) ────────────────────────────────────

export interface ListBenchmarkRunsOptions {
  scenarioId?: string;
  limit?: number;
}

export async function listBenchmarkRuns(
  opts: ListBenchmarkRunsOptions = {}
): Promise<BenchmarkRunRecord[]> {
  const db = createAdminClient();
  let query = db
    .from("benchmark_runs")
    .select("*")
    .order("ran_at", { ascending: false })
    .limit(Math.min(Math.max(opts.limit ?? 50, 1), 200));
  if (opts.scenarioId) query = query.eq("scenario_id", opts.scenarioId);
  const { data, error } = await query;
  if (error) throw new Error(`failed to list benchmark runs: ${error.message}`);
  return (data ?? []) as unknown as BenchmarkRunRecord[];
}

export async function deleteBenchmarkRun(id: string): Promise<boolean> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("benchmark_runs")
    .delete()
    .eq("id", id)
    .select("id");
  if (error) throw new Error(`failed to delete benchmark run: ${error.message}`);
  return (data ?? []).length > 0;
}

// ─── Internals ──────────────────────────────────────────────────────────────

async function persistRun(record: BenchmarkRunRecord): Promise<string | null> {
  const db = createAdminClient();
  // The id column is DB-generated; strip the record's placeholder before insert.
  const row: Record<string, unknown> = { ...record };
  delete row.id;
  const { data, error } = await db
    .from("benchmark_runs")
    .insert(row)
    .select("id")
    .single();
  if (error || !data) {
    logger.warn("[benchmark] persist failed (non-fatal)", {
      scenario: record.scenario_id,
      error: String(error?.message ?? error),
    });
    return null;
  }
  return data.id as string;
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

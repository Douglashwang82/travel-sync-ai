/**
 * Live itinerary benchmark — CLI entry.
 *
 * Runs the real generation pipeline for the scenarios in
 * benchmarks/scenarios.json via the shared runner
 * (services/trip-generation/benchmark-runner.ts), which scores what actually
 * got persisted, optionally grades it with the LLM-as-judge, and records
 * every run in the `benchmark_runs` table (the history the /app/benchmark UI
 * charts). This script additionally appends each row to
 * benchmarks/history.jsonl as a local, grep-able copy.
 *
 * Run:
 *   npm run benchmark:itinerary
 *   npx tsx --env-file=.env.local scripts/benchmark-itinerary.ts --scenario niseko-4d-friends-powder
 *   npx tsx --env-file=.env.local scripts/benchmark-itinerary.ts --no-history --no-judge
 *
 * Flags:
 *   --scenario <id>   Run a single scenario instead of all.
 *   --no-history      Skip the local history.jsonl append.
 *   --no-judge        Skip the LLM-as-judge pass (deterministic metrics only).
 *
 * Costs real Gemini calls and writes real (private) trip_templates authored
 * by `benchmark-runner`, so this is an on-demand tool, not a cron.
 */

import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { execSync } from "node:child_process";
import {
  loadPresetScenarios,
  runBenchmarkScenario,
} from "@/services/trip-generation/benchmark-runner";
import { formatBenchmarkReport } from "@/services/trip-generation/benchmark";

const HISTORY_PATH = path.join(process.cwd(), "benchmarks", "history.jsonl");

function gitRev(): string | null {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const onlyIdx = args.indexOf("--scenario");
  const onlyId = onlyIdx >= 0 ? args[onlyIdx + 1] : null;
  const writeHistory = !args.includes("--no-history");
  const runJudge = !args.includes("--no-judge");

  const all = await loadPresetScenarios();
  const scenarios = onlyId ? all.filter((s) => s.id === onlyId) : all;
  if (scenarios.length === 0) {
    console.error(onlyId ? `no scenario with id '${onlyId}'` : "no scenarios defined");
    process.exit(1);
  }

  const rev = gitRev();
  const rows: Array<Record<string, unknown>> = [];
  let failures = 0;

  for (const scenario of scenarios) {
    console.log(`\n━━ ${scenario.id} — ${scenario.answers.destination}, ${scenario.answers.duration_days}d ${scenario.answers.pace} ━━`);
    const { record, report, verdict } = await runBenchmarkScenario({
      scenario,
      source: "cli",
      judge: runJudge,
      gitRev: rev,
    });
    rows.push(record as unknown as Record<string, unknown>);

    if (!record.ok || !report) {
      failures++;
      console.error(`  FAILED (${record.failure_reason})`);
      continue;
    }

    console.log(formatBenchmarkReport(report));
    if (verdict) {
      console.log(
        `  judge: ${verdict.pass ? "PASS" : "FAIL"} ${(verdict.score * 100).toFixed(0)}/100 ` +
          `(coherence=${(verdict.aspects.day_coherence * 100).toFixed(0)} ` +
          `personalization=${(verdict.aspects.personalization * 100).toFixed(0)} ` +
          `realism=${(verdict.aspects.realism * 100).toFixed(0)} ` +
          `title=${(verdict.aspects.title_summary_quality * 100).toFixed(0)}) — ${verdict.reasoning}`
      );
    } else if (runJudge) {
      console.warn("  judge skipped (call failed; see logs)");
    }
    console.log(
      `  templateId=${record.template_id} versionId=${record.version_id} ` +
        `dbRow=${record.id ?? "(not persisted)"} elapsed=${(record.elapsed_ms / 1000).toFixed(1)}s`
    );
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

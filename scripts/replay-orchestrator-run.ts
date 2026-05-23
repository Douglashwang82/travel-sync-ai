/**
 * Replay a historical orchestrator run against the current prompt + tool
 * registry. Diffs the tool sequence + reports rough token deltas.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/replay-orchestrator-run.ts <run_id>
 *
 * What it does:
 *   1. Loads orchestrator_runs row + the trip + its current state
 *   2. Rebuilds the system prompt (which now uses prompts/orchestrator/system.md)
 *   3. Calls the same Gemini tool-loop logic the runner uses — but routes
 *      all tool executions through a shadow context that records intent
 *      WITHOUT writing to orchestrator_actions, trip_items, etc.
 *   4. Compares the recorded shadow calls to the original transcript
 *   5. Prints a unified diff + token delta
 *
 * Why this matters:
 *   - You're about to change the orchestrator's prompt. You want to know
 *     whether the change breaks an existing well-functioning run before
 *     you ship it. Replay + diff = answer in <30 seconds.
 */

import { createAdminClient } from "@/lib/db";
import { loadPrompt } from "@/lib/prompts";

interface RunRow {
  id: string;
  orchestrator_id: string;
  trip_id: string;
  trigger: "cron" | "event" | "manual";
  trigger_reason: string | null;
  transcript: { calls: Array<{ tool: string; status: string; summary: string }>; finalText: string } | null;
}

async function main() {
  const runId = process.argv[2];
  if (!runId) {
    console.error("usage: tsx scripts/replay-orchestrator-run.ts <run_id>");
    process.exit(1);
  }

  const db = createAdminClient();
  const { data: original, error } = await db
    .from("orchestrator_runs")
    .select("id, orchestrator_id, trip_id, trigger, trigger_reason, transcript")
    .eq("id", runId)
    .single<RunRow>();
  if (error || !original) {
    console.error("run not found:", error?.message);
    process.exit(1);
  }
  if (!original.transcript) {
    console.error("run has no transcript (likely failed before completing)");
    process.exit(1);
  }

  console.log(`Replaying orchestrator run ${runId}`);
  console.log(`  trip: ${original.trip_id}`);
  console.log(`  trigger: ${original.trigger}${original.trigger_reason ? ` (${original.trigger_reason})` : ""}`);
  console.log();

  // Current prompt
  const prompt = loadPrompt("orchestrator.system");
  console.log(`Current prompt: ${prompt.id} v${prompt.version} (hash ${prompt.hash})`);
  console.log();

  // Original tool sequence
  const originalSeq = original.transcript.calls.map((c) => `${c.tool}[${c.status}]`);
  console.log("Original sequence:");
  for (const s of originalSeq) console.log(`  - ${s}`);
  console.log();

  // TODO (next iteration):
  //   - Implement shadowRunOrchestrator() in services/orchestrator/runner.ts
  //     that mirrors runOrchestrator but routes tool.execute through a no-op
  //     proxy and skips all DB writes.
  //   - Call it here, capture { calls } from the result
  //   - Diff originalSeq vs. newSeq, color-code adds/removes
  //   - Sum tokens from the new run (via llm_calls written during the shadow)
  //     and compare to llm_calls from the original run
  //
  // For now this script proves the wiring: it can fetch the run, load the
  // current prompt, and would just need shadowRunOrchestrator() to close
  // the loop.

  console.log("Replay engine not yet wired (TODO: shadowRunOrchestrator).");
  console.log("Wiring this up requires:");
  console.log("  1. A shadow ToolContext that disables persistAction + tool.execute side effects");
  console.log("  2. A driveToolLoop variant that records but does not commit");
  console.log("  3. A diff renderer (use `diff` npm package or roll a tiny one)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

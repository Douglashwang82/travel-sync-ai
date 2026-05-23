---
description: Re-run a historical orchestrator_runs row against the current prompt + tool registry and diff tool calls.
argument-hint: <run_id>
---

Replay an orchestrator run.

**Arguments:** `$ARGUMENTS` — the `orchestrator_runs.id` UUID to replay.

Steps:

1. Run `npx tsx scripts/replay-orchestrator-run.ts $ARGUMENTS` and capture the diff.
2. Summarize:
   - tools called originally vs. now (added/removed/reordered)
   - any new failures
   - rough token delta if the script reports it
3. If the diff is large, recommend whether the prompt change is safe to ship.

The script must NOT write to the live `orchestrator_actions` table — it runs against a shadow context. If the script doesn't exist yet, stop and tell the user.

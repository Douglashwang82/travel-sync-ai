# Eval Harness

Behavioural tests for LLM-driven code paths. Each eval is a fixture + a graded run.

## Running

```bash
# Run all evals (skipped unless an API key is present)
npm test -- evals/

# Force live runs even on CI (slow + costs money)
RUN_LIVE_EVALS=1 npm test -- evals/
```

By default the harness runs in "structure-only" mode — it loads each fixture, instantiates the prompt, but skips the live LLM call. Live mode (`RUN_LIVE_EVALS=1`) actually hits the provider and grades the output with an LLM judge.

## Adding a fixture

Drop a `.json` file under `__tests__/evals/fixtures/<task_class>/`:

```json
{
  "id": "parsing.add-restaurant",
  "task_class": "parsing",
  "input": { "text": "let's eat at Tatami in Kyoto on day 2" },
  "expect": {
    "must_include": ["Tatami", "Kyoto"],
    "must_call_tool": "items.create",
    "judge_rubric": "Extracted restaurant name + city; created a board item."
  }
}
```

The fixture format is intentionally loose — each eval runner picks the fields it needs. The shared bits are `id`, `task_class`, `input`, `expect`.

## Judging

`evals/judge.ts` calls Claude (preferred) with a strict rubric and returns `{ pass: boolean, score: number, reasoning: string }`. Judge runs are recorded in `llm_calls` with `task_class='other'` and `metadata.role='judge'` so they don't pollute the orchestrator dashboards.

## CI

Wire `npm test -- evals/` into a GitHub Action gated by a path filter on `prompts/**`, `services/parsing/**`, `services/orchestrator/**`, and `lib/llm.ts`. The structure-only mode runs on every push so a missing fixture file or invalid JSON fails fast even without API keys.

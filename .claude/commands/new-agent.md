---
description: Scaffold a new background agent under services/agents/ with config schema, run(), and registry wiring.
argument-hint: <agent_type> "<one-line description>"
---

Scaffold a new background agent.

**Arguments:** `$ARGUMENTS` — first token is the snake_case agent type (e.g. `currency_watch`); the rest is the description.

Steps:

1. Read `services/agents/types.ts` and one existing agent (e.g. `services/agents/flight-price-tracker.ts`) to match the shape.
2. Create `services/agents/<kebab-name>.ts` exporting an object satisfying `AgentDefinition`:
   - `type` = the snake_case arg
   - `label`, `description`, `icon`, `mode`, `defaultFrequencyHours`
   - Zod `configSchema`
   - `defaultConfig`
   - `configFields` for the picker UI
   - `run(ctx)` returning `AgentRunResult` (use a deterministic stub if no API key is available; never throw on empty data)
3. Register it in `services/agents/registry.ts` (import + push into `AGENTS`).
4. Add a unit test under `__tests__/unit/agents/<kebab>.test.ts` calling `run()` with a fake context.
5. Update `docs/CHANGELOG.md`.

If the agent needs an external API, stub the fetcher and put the env var name in the comment so it's grep-able later.

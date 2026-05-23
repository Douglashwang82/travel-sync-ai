---
description: Scaffold a new orchestrator tool in services/orchestrator/tools.ts with Zod args, dryDescribe, execute, and a unit test.
argument-hint: <tool.name> "<one-line description>"
---

Scaffold a new orchestrator tool.

**Arguments:** `$ARGUMENTS` — first token is the dotted tool name (e.g. `items.duplicate`); the rest is the human description.

Steps:

1. Read `services/orchestrator/tools.ts` and `services/orchestrator/types.ts` so you match the existing `defineTool` shape.
2. Append a new `defineTool({...})` entry to `tools.ts`. The tool MUST:
   - have a Zod `args` schema (no `z.any()` / `z.unknown()`)
   - implement `dryDescribe(a)` for the propose lane
   - implement `execute(ctx, a)` returning `{ summary, data?, target? }`
   - pick a sensible `defaultAutonomy` (`propose_only` for anything destructive)
   - register itself in the tools array
3. Add a unit test under `__tests__/unit/orchestrator-tools/<name>.test.ts` exercising args validation + the happy path with a mocked db.
4. Mention the new tool in `docs/CHANGELOG.md` under an "Unreleased" heading.
5. Run `npm test -- orchestrator-tools/<name>` and report the result.

Do **not** call `@line/bot-sdk` directly — go through `lib/line.ts`.

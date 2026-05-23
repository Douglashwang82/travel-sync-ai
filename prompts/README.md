# Prompt Registry

Every system prompt loaded by the runtime LLM clients lives here as a `.md` file with frontmatter.

The loader (`lib/prompts.ts`) reads frontmatter for `{ id, version, owner, task_class }` and computes a sha256 of the body. That hash is stored in `llm_calls.prompt_hash` so any prompt change is replayable and regression-testable.

## Adding a prompt

1. Create `prompts/<area>/<name>.md`:

   ```markdown
   ---
   id: orchestrator.system
   version: 1
   owner: dougl
   task_class: orchestrator
   ---

   You are the per-trip Orchestrator. ...
   ```

2. Load it from code:

   ```ts
   import { loadPrompt } from "@/lib/prompts";

   const prompt = loadPrompt("orchestrator.system");
   // prompt.body, prompt.hash, prompt.id, prompt.version
   ```

3. The body supports `{{placeholder}}` substitution via `renderPrompt(prompt, vars)`.

## Migrating an existing inline prompt

- Pick a stable `id` (e.g. `parsing.extractor.system`)
- Copy the prompt body verbatim into the new `.md` file
- Replace the inline string in code with `loadPrompt(id)`
- The hash captured at telemetry time pins the version — if you edit, bump `version:` in the frontmatter so dashboards can group by it

## Conventions

- One prompt per file
- Body is markdown but interpreted as plain text by the LLM (markdown formatting is purely for human readability)
- Placeholder names: `{{snake_case}}` only, validated by `renderPrompt`

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Mandatory checks before every commit

After every code change, run these three commands and fix all errors before committing:

```bash
npm run build          # type gate — must exit 0 (zero TypeScript errors)
npm run lint           # ESLint — must exit 0 (zero lint errors)
npm test               # Vitest — must not introduce new test failures
```

`npm run build` is the **only** type-checker; there is no separate `tsc` or `typecheck` script.
Do **not** report a task as complete if any of these three commands emit errors.

## Commands

```bash
npm run dev            # Next.js dev server on :3000
npm run build          # Production build + type check
npm run lint           # ESLint (flat config in eslint.config.mjs)
npm test               # Vitest run (all tests under __tests__/)
npm run test:watch     # Vitest watch mode
npm run test:coverage  # Coverage report (v8)

# Run a single test file or a single test by name
npx vitest run __tests__/unit/vote-command.test.ts
npx vitest run -t "majority closes vote"

# LINE rich menu management (uses .env.local via tsx --env-file)
npm run setup:rich-menu
npm run delete:rich-menu

# Route synthesis (uses .env.local via tsx --env-file)
npm run synth:routes
```

There is no `typecheck` script — `next build` is the type gate. Tests are isolated per file (`vitest.config.ts`) to reset module-level state (rate limiter, etc.).

Path alias: `@/*` maps to repo root (e.g. `@/services/event-processor`, `@/lib/line`).

## Architecture invariants (do not violate)

This is an AI-powered travel agent app that helps travelers gather information, make decisions, get suggestions, and manage trips end-to-end. LINE is the messaging interface; the web app at `/app` is the primary UI. The async pipeline funnels through three chokepoints — before adding inbound, dispatch, or outbound code, check whether it already exists.

- **Single inbound endpoint:** `app/api/line/webhook/route.ts`. Verifies LINE signature, persists every event to `line_events` (idempotent via `line_event_uid`), returns 200 in <1s, schedules processing via Next.js `after()`.
- **Single dispatcher:** `services/event-processor.ts` routes by `(event.type, source.type)`. DM detection: `lineGroupId === userId`. Slash commands (`text.startsWith("/")`) → `bot/router.ts`. Free text in groups → `services/parsing/` (Gemini-powered entity extraction). Free text in 1:1 → `services/private-chat/` (LLM reasoning). Postbacks keyed on `prefix|...` data scheme → `handlePostback()`.
- **Single outbound chokepoint:** `lib/line.ts`. Never call `@line/bot-sdk` directly outside this file (CLI scripts in `scripts/` are the only exception). All pushes tracked in `outbound_messages` with retry + backoff.
- **Durable queue = `line_events` table.** No external queue lib. Webhook fast-path is `after()`; the `process-events` cron (`app/api/cron/process-events/route.ts`) is the recovery sweeper for crashed workers, stalled `processing` rows (>5 min), and `failed` rows whose `next_retry_at` has elapsed. Backoff: `2^(retry_count+1)s`, capped at 1h, via `computeNextRetryAt` in `services/event-processor.ts`.
- **Per-trip AI orchestrator** (`services/orchestrator/`). Each trip gets a tool-use loop (max 8 turns, Gemini or Claude) that can read and mutate trip state. Triggered by cron sweeper (`app/api/cron/orchestrator/route.ts`) or immediately via `wakeOrchestrator(tripId, reason)` on relevant mutations. Tools live in `services/orchestrator/tools.ts`; the autonomy dial enforces propose-only vs. auto-apply per trip.
- **Agent system** (`services/agents/`). Eight agents (flight-price-tracker, weather-forecast, chat-digest, itinerary-drafter, packing-suggester, hotel-price-watch, consensus-radar, social-media-photos) run on custom grids. Modes: **monitor** (read-only), **propose** (draft pending items for human review), **assist** (on-demand). Scheduled via `app/api/cron/agent-grids/route.ts` with dependency ordering. Never add agent logic outside this system.
- **Two LLM providers, one router.** `lib/llm.ts` routes tasks to Gemini (default: `gemini-2.5-flash`) or Anthropic Claude (default: `claude-sonnet-4-6`) via `LLM_PROVIDER_<TASK_CLASS>` env vars. Never call `@google/genai` or `@anthropic-ai/sdk` directly outside `lib/gemini.ts` / `lib/llm.ts`. All calls logged to `llm_calls` for cost tracking and replay.
- **Notifications are event-sourced**, not cron-driven. `services/notifications/index.ts` exposes `notifyXxx()` wrappers; crons handle reminders/digests only, not primary delivery.
- **MCP server** (`app/api/mcp/route.ts`). JSON-RPC 2.0 endpoint for external AI clients (Claude Desktop, Cursor). Authenticated via `MCP_SIGNING_SECRET`.

## Layout at a glance

- `app/api/line/webhook/` — sole LINE inbound route
- `app/api/cron/` — Vercel cron handlers; schedule lives in `vercel.json`, auth via `CRON_SECRET` (`lib/cron-auth.ts`)
- `app/api/app/` — JSON endpoints for the `/app` web client (LINE Login or email/password, see `lib/app-line-login.ts`, `lib/app-server.ts`)
- `app/app/` — web app pages (dashboard, itinerary, votes, expenses, ops, readiness, profile, templates, inbox)
- `bot/router.ts` + `bot/commands/*.ts` — slash command implementations; new commands must register in `bot/command-registry.ts` and respect `bot/command-guards.ts`
- `services/*` — feature-scoped domain logic (parsing, vote, decisions, expenses, incidents, orchestrator, trip-generation, tracking, readiness, operations, notifications, agents, …). The dispatcher fans out into these; do not bypass it.
- `lib/db.ts` — Supabase clients. Server code uses `createAdminClient()` (service role). Never import the service-role key directly.
- `lib/gemini.ts` — sole Gemini wrapper (circuit-breaker protected); model defaults to `gemini-2.5-flash`, overridable via `GEMINI_MODEL`.
- `supabase/migrations/` — timestamped SQL migrations; apply via `npx supabase db push`. `lib/database.types.ts` is generated from these.
- `app/app/docs/`, `lib/docs/`, `components/app/docs-toc.tsx` — in-app project documentation surface at `/app/docs` (API reference, DB schema, user guide, SAD). See "Documentation surface" below.
- `__tests__/{unit,integration,flows,api,setup}` — Vitest suites. `__tests__/setup/vitest.setup.ts` runs first.
- `docs/SPEC.md`, `docs/runbook.md`, `docs/PUBLISH_READINESS.md`, `docs/CHANGELOG.md` — source-of-truth product spec, ops procedures, launch checklist, and changelog (update on feature completion).

## Project conventions

These live in `.agents/rules/`; the important ones to internalize:

- **Next.js 16 is not the Next.js in your training data.** APIs, conventions, and file structure have breaking changes. When in doubt, read `node_modules/next/dist/docs/` before writing route, layout, or server-action code, and heed deprecation notices.
- **Spec-driven:** Read `docs/SPEC.md` before making product-shaped changes; update `docs/CHANGELOG.md` on feature completion.
- **Zod-first APIs:** Every API route validates request body and query with Zod at the top of the handler. Untrusted input is typed `unknown` until parsed. Error shape: `{ error: string, code: string, details?: any }`.
- **UI:** `shadcn/ui` components in `components/ui/`. Use Tailwind utility classes and the `cn()` helper exclusively — no custom CSS files. Check `components/ui/` before adding a new primitive; install missing ones via `npx shadcn@latest add`.
- **No deprecated packages.** Prefer latest stable Supabase v2 patterns; do not introduce v1 env-var conventions.
- **Never delete existing tests.** If a change breaks a test, update the test or revert the change.
- **MVP discipline:** Boring tech over experimental. If a feature would take >4h, propose a manual workaround or SaaS shortcut instead.

## Documentation surface

The `/app/docs` page is the canonical project doc. **Every code change that touches user-visible behavior, the architecture, an HTTP route, or the database must keep it in sync.** Some of that is automatic; some requires editing `lib/docs/copy.ts`. Know which is which before assuming the docs are still correct.

**Auto-generated (no manual update needed):**

- **API reference** — `lib/docs/api-parser.ts` walks `app/api/**/route.ts` at request time. New routes appear automatically. To give an endpoint a description, write a `/** ... */` JSDoc immediately above the exported `GET` / `POST` / etc. handler — the parser picks up the first one.
- **Database schema** — `lib/docs/schema-parser.ts` parses `supabase/migrations/*.sql` (`CREATE TABLE` + later `ALTER TABLE ADD COLUMN`). Tables and columns appear automatically as soon as the migration file lands.

**Manual update required (edit `lib/docs/copy.ts`, both `EN` and `ZH_TW`):**

- **User guide** (`copy.guide.sections`) — update whenever user-visible behavior changes: new/removed slash command, new web page or tab, changed flow, new permission, new privacy-affecting action.
- **SAD** (`copy.sad.sections`) — update whenever architecture changes: new service module under `services/`, new chokepoint, new pipeline, removed feature surface, new cron job category, changes to the inbound/dispatcher/outbound invariants.
- **API grouping** — if a new top-level `app/api/<bucket>/...` directory appears, add a corresponding group in `deriveGroup()` inside `lib/docs/api-parser.ts` so endpoints don't fall into "Other".
- **Sidebar nav** — only when adding a new top-level docs surface; the existing `/app/docs` entry already covers all four sections.

**Discipline:** Update `lib/docs/copy.ts` in the same commit as the code change, not in a follow-up. If a PR adds a feature, adds a route, or removes a feature, the docs edit is part of that PR. Bilingual is non-negotiable — `EN` and `ZH_TW` stay in lockstep.

## Environment

Local dev needs `.env.local` (copy from `.env.example`). Required: `LINE_CHANNEL_SECRET`, `LINE_CHANNEL_ACCESS_TOKEN`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `GEMINI_API_KEY`. Optional: `ANTHROPIC_API_KEY` (enables Claude via `lib/llm.ts`), `LLM_PROVIDER_DEFAULT` / `LLM_PROVIDER_<TASK_CLASS>` (route tasks to gemini or anthropic), `GOOGLE_MAPS_SERVER_API_KEY`, `MCP_SIGNING_SECRET`. `CRON_SECRET` is required in production for Vercel cron auth. Health check: `GET /api/health`.

For local LINE webhook testing, expose port 3000 via ngrok and set `https://<subdomain>.ngrok.io/api/line/webhook` as the channel's webhook URL.

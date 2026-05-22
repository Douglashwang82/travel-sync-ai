# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev            # Next.js dev server on :3000
npm run build          # Production build
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
```

There is no `typecheck` script — `next build` is the type gate. Tests are isolated per file (`vitest.config.ts`) to reset module-level state (rate limiter, etc.).

Path alias: `@/*` maps to repo root (e.g. `@/services/event-processor`, `@/lib/line`).

## Architecture invariants (do not violate)

This is a LINE bot whose entire async pipeline funnels through three chokepoints. Before adding "let's add X" for webhook, event, or outbound code, check whether it already exists.

- **Single inbound endpoint:** `app/api/line/webhook/route.ts`. Verifies signature, persists every event to `line_events` (idempotent via `line_event_uid`), returns 200 in <1s, schedules processing via Next.js `after()`.
- **Single dispatcher:** `services/event-processor.ts` routes by `(event.type, source.type)`. DM detection: `lineGroupId === userId`. Slash commands (`text.startsWith("/")`) → `bot/router.ts`. Free text in groups → `services/parsing/` (the "group monitor"). Free text in 1:1 → `services/private-chat/` (LLM reasoning via Gemini).
- **Single outbound chokepoint:** `lib/line.ts`. Never call `@line/bot-sdk` directly outside this file (CLI scripts in `scripts/` are the only exception). All pushes are tracked in `outbound_messages` with retry + backoff.
- **Durable queue = `line_events` table.** No external queue lib. Webhook fast-path is `after()`; the `process-events` cron (`app/api/cron/process-events/route.ts`) is the recovery sweeper for crashed workers, stalled `processing` rows (>5 min), and `failed` rows whose `next_retry_at` has elapsed. Backoff: `2^(retry_count+1)s`, capped at 1h, via `computeNextRetryAt` in `services/event-processor.ts`.
- **Postbacks are not commands.** They live in `services/event-processor.ts` `handlePostback`, keyed on a `prefix|...` data scheme.
- **Notifications are event-sourced**, not cron-driven. `services/notifications/index.ts` exposes `notifyXxx()` wrappers; crons handle reminders/digests, not the primary delivery path.

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

## Environment

Local dev needs `.env.local` (copy from `.env.example`). Required for the bot to function: `LINE_CHANNEL_SECRET`, `LINE_CHANNEL_ACCESS_TOKEN`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `GEMINI_API_KEY`. `CRON_SECRET` is required in production for the Vercel cron routes to authenticate. Health check: `GET /api/health`.

For local LINE webhook testing, expose port 3000 via ngrok and set `https://<subdomain>.ngrok.io/api/line/webhook` as the channel's webhook URL.

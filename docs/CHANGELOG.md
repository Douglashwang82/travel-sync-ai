# Changelog

## [Unreleased] — Phase 5: Automation and Hardening

### Added
- `lib/rate-limit.ts` — in-memory sliding-window rate limiter; 60 commands/min per group, 10/min per user; applied in command router before dispatch; `/help`, `/optout`, `/optin` exempt
- `lib/cron-auth.ts` — `verifyCronRequest()` helper; replaces inline auth blocks in all 4 cron routes
- `lib/env.ts` — `validateEnv()` checks all required env vars at first request; fails fast with a descriptive error and copy-paste instructions
- `lib/line.ts` — `pushText`/`pushFlex` now log to `outbound_messages` table (status: pending → sent/failed); `retryFailedOutbound()` sweeps failed rows (max 3 retries); called from `process-events` cron
- `bot/commands/optout.ts` — `/optout` and `/optin` persist `optout_at` in `group_members`; parsing pipeline skips opted-out users
- `services/parsing/index.ts` — added optout check (step 0) before relevance filter
- Supabase migration `20260403000002_optout.sql` — adds `optout_at timestamptz` to `group_members`
- `scripts/setup-rich-menu.ts` — one-time script to create LINE persistent rich menu (Dashboard / Itinerary / Help) and set as default
- `scripts/delete-rich-menu.ts` — cleanup script to delete a rich menu by ID
- npm scripts: `setup:rich-menu`, `delete:rich-menu`
- `CRON_SECRET` added to `.env.example`

## [Unreleased] — Phase 4: Decisions

### Added
- `services/decisions/places.ts` — Google Places Text Search API v1 client; maps item types to search queries; normalizes price levels to $/$$/$$$/$$$$
- `services/decisions/flex.ts` — LINE Flex Message carousel builder; up to 5 option bubbles with photo, name, rating, price, address, Vote postback button, and optional booking link; `buildWinnerMessage()` for closure announcements
- `services/vote/index.ts` — `castVote()` (upsert, majority check against group size), `closeVote()` (confirmItem + analytics), `getVoteTally()`
- `services/decisions/index.ts` — `startDecision()` orchestrates Places fetch → option persistence → `startVote()` → carousel push; `refreshVoteCarousel()` updates live vote counts; `announceWinner()` sends closure message
- `bot/commands/vote.ts` — now calls `startDecision()`; acknowledges immediately then runs decision flow async
- `services/event-processor.ts` — `handlePostback()` parses `vote|itemId|optionId` format, records vote, closes on majority or refreshes carousel
- `POST /api/liff/votes` — LIFF vote endpoint; same logic as postback handler, returns tally + closed/winner state

## [Unreleased] — Phase 3: AI Parsing

### Added
- `services/parsing/relevance.ts` — rules-based relevance filter; skips stickers, short replies, greetings before any LLM call
- `services/parsing/context.ts` — assembles compact trip context (destination, dates, open items, recent entities) from DB — no raw chat history
- `services/parsing/extractor.ts` — Gemini `generateJson` call with zh-TW travel entity extraction prompt; Zod-validates response; drops entities below 0.6 confidence
- `services/parsing/conflict.ts` — creates Pending board items for LLM-detected contradictions (e.g. two departure dates)
- `services/parsing/item-generator.ts` — persists `parsed_entities`, updates trip core fields (destination/dates), auto-creates To-Do items from `create_todo_item` actions
- `services/parsing/index.ts` — pipeline entry point: relevance → context → LLM → conflict → apply → analytics
- `services/event-processor.ts` — non-command messages now run through `parseMessage()` instead of being discarded

## [Unreleased] — Phase 2: Core State

### Added
- Trip state service (`services/trip-state/`) — `createItem`, `updateItem`, `deleteItem`, `startVote`, `confirmItem`, `reopenItem`, `getActiveTrip`, `getItemWithOptions`
- `POST /api/liff/items` — unified board item mutation (create / update / reopen / delete) with Zod validation
- `GET /api/liff/itinerary` — confirmed items with option details, grouped by date for timeline view
- LIFF dashboard — add-item sheet, tap-to-view item detail sheet, reopen/delete actions (organizer only)
- LIFF itinerary page — confirmed items timeline grouped by date with option card (image, rating, booking link)
- `GET /api/cron/process-events` — recovery sweeper: reprocesses pending/failed events (runs every minute)
- `GET /api/cron/vote-deadlines` — closes expired votes, handles ties with 12h extension (runs every 5 min)
- `GET /api/cron/stale-reminders` — nudges groups with 48h+ untouched To-Do items (runs hourly)
- `GET /api/cron/cleanup` — purges expired raw_messages, old line_events, old analytics (runs daily)
- Supabase migration: `increment_retry_count` RPC for atomic retry tracking
- Gemini client (`lib/gemini.ts`) — `generateJson<T>()` and `generateText()` using `gemini-2.0-flash`
- Switched LLM dependency from `openai` to `@google/genai`

## [Unreleased] — Phase 1: Foundation

### Added
- Next.js 15 app scaffolded with TypeScript, Tailwind CSS, App Router
- Supabase v2 client (`lib/db.ts`) with browser and admin clients
- LINE SDK helpers (`lib/line.ts`) — signature verification, reply/push helpers
- Analytics tracker (`lib/analytics.ts`) — thin wrapper over `analytics_events` table
- Domain types (`lib/types.ts`) — all enums and interfaces matching the DB schema
- shadcn/ui components: button, card, badge, separator
- `cn()` utility (`lib/utils.ts`)
- Supabase migration: all 11 tables with indexes and RLS policies
- `POST /api/line/webhook` — signature verification, event persistence, 200 OK, async dispatch
- Bot command router (`bot/router.ts`)
- `/start` command handler
- `/help` command handler
- `GET /api/liff/session` — resolve LIFF user and group context
- LIFF dashboard page skeleton
- `docs/SPEC.md` — implementation specification
- `.env.example` — required environment variables

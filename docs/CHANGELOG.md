# Changelog

## [Unreleased] — Japan Ski Refocus (v1)

### Added
- `lib/ski-ingest.ts` — pure-function shape adapters that turn the per-region JSON bundles under `data/japan-ski-trip/{niseko,hakuba,naeba,nozawa-onsen,shiga-kogen,zao-onsen}/*.json` into `poi_embeddings`-shaped rows (resorts, hotels, restaurants, on/off-mountain activities, transport gateways)
- `scripts/ingest-ski-regions.ts` — walks the six deep-detail region directories, generates Gemini embeddings, upserts on `place_id`; supports `--regions` filter and `--dry-run`; ingests 157 rows on the current dataset
- `lib/ski-destination.ts` — `detectJapanSkiDestination()` resolves a free-text destination to one of the six v1 regions using strong aliases only (bare prefecture / country names intentionally do not match)
- `services/trip-generation/ski-prefs.ts` — `skiPrefsToVibe()` maps the new ski-prefs survey shape (level, terrain, onsen_priority, family_friendly, non_ski_days) onto the existing `vibe` vocabulary so the orchestrator's retrieval contract is unchanged
- `__tests__/unit/ski-{ingest,destination,prefs}.test.ts` — 38 unit tests covering ingest row shape, region detection, ski-prefs translation, and the conditional survey state machine
- Edition badge on the marketing site nav: "Japan Ski" / "日本滑雪"

### Changed
- `services/parsing/extractor.ts` — system prompt is augmented with ski-specific entity guidance (resort names, lift passes, rentals, onsen, ski level, ski-in/ski-out) only when the trip destination resolves to a Japan ski region
- `services/private-chat/index.ts` — TravelBot persona augmented with ski-region context (resort suggestions, onsens, après-ski dining) when applicable
- `services/trip-generation/orchestrator.ts` — LLM day-picker prompt biases toward `ski_resort` / `onsen` / `ski_in_ski_out` tagged POIs and a ski → lunch → onsen → dinner day shape for ski destinations
- `services/trip-generation/index.ts` — `SurveyQuestionKey` and `SurveyAnswers` extend with `ski_prefs`; `SURVEY_STEP_ORDER` documents the conditional branch
- `services/trip-generation/survey.ts` — `nextStepAfter()` is now answer-aware: ski destinations skip the `vibe` step and ask `ski_prefs` instead; the answer is mirrored back into `answers.vibe` via `skiPrefsToVibe()` so downstream code keeps its contract
- `services/trip-generation/flex.ts` — new `ski_prefs` LINE flex bubble offering five preset combos (beginner family, intermediate +onsen, intermediate, advanced powder, expert backcountry)
- `app/home-page-client.tsx` + `app/app/page.tsx` + `README.md` — marketing copy, dashboard empty-state, and README subtitle swap the Osaka examples for Niseko Jan 5–12 and clarify the Japan-ski focus while noting that generic destinations still work
- `components/app/trip-map-canvas.tsx` — when no destination/pins are set, defaults to the Japan ski belt midpoint (38.5°N, 138.5°E) at country-level zoom (5) so all six v1 regions stay visible

### Fixed
- Workspace bento grids now render for group-less (personal) trips. The votes, expenses, and pack **GET** endpoints (`app/api/app/trips/[tripId]/{votes,expenses,pack}/route.ts`) dropped `requireAppTripWithGroup` for the looser `requireAppTripAccess`, so the Votes, Budget, Map, and Pack tiles no longer get back `GROUP_REQUIRED` on a trip with no LINE group. Group-scoped sub-queries (`group_members`) are skipped when `groupId` is null, and `loadTripExpensesForGroup()` returns a budget-only/empty ledger for group-less trips.
- Personal ("mine") packing items can now be added on group-less trips; only the shared ("group") scope of the pack **POST** still requires a LINE group.
- `lib/types.ts` — `Trip.group_id` is now typed `string | null`, matching the nullable DB column (`group_id` lost its `NOT NULL` constraint in the app-users/trip-members migration).

### Notes
- Generic (non-Japan-ski) trips are explicitly unaffected by all three prompt augmentations and the survey branch — a Tokyo or Bangkok trip walks the original code paths.
- `scripts/ingest-ski-dataset.ts` (the nationwide shallow index, 33 resorts under `data/japan-ski-trip/national/`) is unchanged; the new region ingester is complementary.
- Web wizard at `/app/trips/new` still asks the legacy `vibe` question; aligning that with the LINE survey branching is left to a follow-up PR to keep this change focused.

## [Unreleased] — AI-Native Foundations

### Added
- `lib/trip-link.ts` — shared helpers (`buildTripUrl`, `getTripUrlForGroup`, `getTripUrlForItem`, `appendTripLinkText`, `withFlexTripLink`) for surfacing the web-app trip URL in bot responses. Replaces the inline `withLink` logic in `bot/router.ts` and is now used across event-processor postbacks, parsing acks, private chat, decisions (start/winner/booking prompt), notifications agent-ack, orchestrator `chat.notify_group` tool, daily briefing, and the stale-reminder / vote-deadline / readiness / daily-digest crons — so every trip-context bot message links back to the trip board (or the relevant subpage)
- `__tests__/unit/trip-link.test.ts` — 13 unit tests covering URL construction, group/item resolution, text append, Flex bubble footer, carousel no-op, and null-URL handling
- `.claude/commands/{new-tool,new-agent,new-migration,replay-orchestrator-run}.md` — project slash commands for Claude Code
- `.claude/agents/{orchestrator-tool-writer,prompt-evaluator,migration-author}.md` — project-scoped subagents
- `.claude/settings.json` — hooks (post-edit ESLint, pre-commit related tests) + permission allowlist
- `llms.txt` (repo root) + `public/llms.txt` — discoverability for AI agents and crawlers
- `lib/prompts.ts` + `prompts/` directory — versioned, content-hashed prompt registry. Migrated orchestrator system prompt + new private-chat system prompt into the registry
- `lib/llm.ts` — model-agnostic LLM client over Gemini + Anthropic, with per-task routing via `LLM_PROVIDER_<TASK_CLASS>` env vars
- `lib/llm-telemetry.ts` + `lib/llm-pricing.ts` — every Gemini/Anthropic call is recorded in `llm_calls` with tokens, latency, estimated cost, prompt hash
- Supabase migration `20260523000000_llm_calls.sql` — telemetry table for cost dashboards and replay
- Supabase migration `20260523000001_trip_memory_embeddings.sql` — pgvector column on `trip_memories` + `match_trip_memories` RPC for cross-trip semantic recall
- `services/memory/recall.ts` — embeds a free-text query and returns the top-K similar places across the user's groups
- `services/voice/index.ts` — LINE audio fetch + Gemini transcription scaffold (event-processor wiring still TODO)
- `app/api/mcp/route.ts` — MCP server exposing the orchestrator tool registry over JSON-RPC 2.0 with HMAC-signed bearer tokens
- `app/api/app/chat/stream/route.ts` — SSE streaming endpoint for /app private chat (LINE stays unary)
- `__tests__/evals/` — eval harness scaffold with structure-only + live (`RUN_LIVE_EVALS=1`) modes and LLM-as-judge
- `scripts/replay-orchestrator-run.ts` — shadow-replay scaffold (depends on a future `shadowRunOrchestrator`)
- `@anthropic-ai/sdk` dependency

### Changed
- `lib/gemini.ts` — `generateJson<T>(systemPrompt, userMessage, schema?)` now accepts an optional Zod schema and validates JSON at runtime; new `GeminiSchemaError` for validation failures. Backward-compatible — schema is optional
- `services/orchestrator/runner.ts` — split system prompt into static (rules + playbook + tool registry → cacheable across runs) and dynamic (trip context → first user turn); every Gemini turn now emits an `llm_calls` row tagged with `task_class='orchestrator'`, `orchestrator_run_id`, and `cachedTokensIn` so the implicit-cache savings are measurable
- `.gitignore` — share `.claude/{commands,agents,settings.json}` with the team; keep worktrees local

## [Unreleased] — Phase 6: Group Decision Authoring

### Added
- `bot/commands/decide.ts` — `/decide [item]` command; creates a `decision` item (item_kind: "decision") on the trip board; normalises bare type names (e.g. "restaurant" → "Choose restaurant"); blocks duplicate decisions and redirects to `/vote`
- `bot/commands/option.ts` — `/option [decision-item] | [option-name]` command; lets any group member manually attach a voteable option to a decision item before or during voting; deduplicates by case-insensitive name; works on both `todo` and `pending` items
- `services/trip-state/addOption()` — service function that inserts a `trip_item_options` row with `provider: "manual"`; validates item kind and stage; returns typed `AddOptionResult`
- `lib/command-catalog.ts` — added `/decide` and `/option` catalog entries; both appear in `/help` output and LIFF command list
- Supabase migration `20260409010000_trip_item_kinds.sql` — adds `item_kind TEXT NOT NULL DEFAULT 'task'` to `trip_items` with check constraint `('task', 'decision')`
- `__tests__/unit/option-command.test.ts` — 10 unit tests covering input validation, trip/item lookup, task-vs-decision guard, successful addition on todo and pending items, duplicate rejection, item-kind preference, and DB error path

### Changed
- Gemini client now defaults to `gemini-2.5-flash` and supports `GEMINI_MODEL` override.

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
- Gemini client (`lib/gemini.ts`) — `generateJson<T>()` and `generateText()` using Google Gemini
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

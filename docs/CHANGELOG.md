# Changelog

## [Unreleased] — Japan Ski Refocus (v1)

### Added
- **Itinerary quality benchmark** — a deterministic scoring harness for generated itineraries so generator changes can be measured instead of eyeballed:
  - `services/trip-generation/benchmark.ts` — pure scorer (no LLM, no I/O): seven weighted metrics (coverage, pace_fit, meal_coverage, travel_efficiency, diversity, vibe_alignment, must_haves) aggregated to a 0–100 total, plus adapters for solver output (`RoutedDay[]`) and persisted `trip_template_items`
  - `__tests__/evals/itinerary.eval.test.ts` + fixtures under `__tests__/evals/fixtures/itinerary/` — offline CI gate: golden fixtures assert a score floor, a deliberately flawed fixture asserts a ceiling (proves the scorer keeps catching planted defects); runs on every `npm test`, no live mode needed
  - `npm run benchmark:itinerary` (`scripts/benchmark-itinerary.ts`) — runs the real generation pipeline for the scenarios in `benchmarks/scenarios.json`, scores the persisted template read back from the DB, and appends per-metric history rows (git rev, scores, elapsed) to `benchmarks/history.jsonl` for longitudinal tracking
  - `services/trip-generation/benchmark-judge.ts` — LLM-as-judge layer for the subjective qualities rules can't measure (day coherence, personalization, realism, title/summary quality), routed through `lib/llm` (Anthropic preferred). Runs by default on live benchmark runs (`--no-judge` to skip; verdict recorded in `history.jsonl`) and on golden fixtures behind `RUN_LIVE_EVALS=1`
  - **Web benchmark console** — the benchmark is now fully operable from the web app:
    - `supabase/migrations/20260703000000_benchmark_runs.sql` — `benchmark_runs` table (RLS deny-anon): one row per run with answers, per-metric scores, stats, judge verdict, template/version ids, git rev and elapsed time; written by both the CLI and the web
    - `services/trip-generation/benchmark-runner.ts` — shared "generate → score → judge → record" runner used by the CLI script and the web API; persistence is non-fatal so a scored result is never lost to a DB hiccup
    - `app/api/app/benchmark/` — `GET scenarios` (presets from `benchmarks/scenarios.json`), `GET runs` (history, filterable), `POST runs` (execute a preset or inline ad-hoc scenario synchronously, `maxDuration 300`), `DELETE runs/[id]`; Zod-first, signed-in users only; new "App API · Benchmark" docs group
    - `/app/benchmark` (`components/app/benchmark-client.tsx`, sidebar entry) — preset scenario cards with one-click Run, a custom-run dialog (destination/days/party/budget/pace/vibes/must-haves + judge toggle), a per-scenario score-trend line chart (CVD-validated palette, stable series colors, hover tooltip, light/dark), and an expandable run-history table with per-metric and judge-aspect bars, reasoning, and row delete; bilingual (EN + ZH_TW)
  - Docs surface updated (SAD "Trip generator pipeline" gains a Quality benchmark entry, EN + ZH_TW)
- **Trip overview → free-form pan & zoom canvas** — the trip overview (`/app/trips/[tripId]/overview`) is rebuilt as an infinite, pannable/zoomable board of free-floating tiles, replacing the fixed 12-column bento grid:
  - New `components/app/canvas/`: `trip-canvas` (overflow-hidden viewport + translate/scale world layer; background-drag pans, wheel pans / ⌘·Ctrl-wheel zooms toward the cursor, toolbar with zoom in/out, **Fit** to frame all tiles, and **Reset**), `canvas-tile` (pointer-driven free drag from the header + corner resize, screen deltas divided by zoom for 1:1 tracking, bring-to-front on focus), `use-canvas-layout` (layout state + persistence), and `trip-canvas-page` (owns the tile roster, custom-grids fetch and Add-grid dialog). Tiles reuse the existing `grids/*` feature clients and the `.bento-frame`/`.bento-embed` surface chrome; no new dependency
  - Layout is **per-user, per-trip**: tile positions/sizes + the pan/zoom viewport persist to the new `trip_canvas_layouts` table (`supabase/migrations/20260701000000_trip_canvas_layouts.sql`, unique on `(trip_id, app_user_id)`, RLS deny-anon) via `GET`/`PUT /api/app/trips/[tripId]/canvas-layout` (Zod-validated upsert). A member's board follows them across devices; new features auto-place on a fresh shelf so nothing is hidden
  - `components/app/trip-workspace.tsx` now toggles **Canvas ↔ Orchestrator** (legacy `?mode=bento` / stored `bento` values map to canvas). **Retired:** `trip-bento-page`, `grids/bento-frame`, `grids/use-bento-layout`
  - Docs surface updated (guide "Overview canvas", SAD "Trip overview canvas", EN + ZH_TW)
- **Index page redesigned as an interactive survey pipeline** — the marketing landing is replaced by a single four-phase animated scene (`app/home-page-client.tsx` + `components/home/`):
  - **Globe** — a dependency-free spinning dotted earth on `<canvas>` (drag to spin, auto-rotation, reduced-motion aware) with clickable markers for the available countries (Japan, Taiwan, United States); a word-staggered hero line ("Where do you want to go?") sits middle-top and re-types per phase
  - **POI media wall** — picking a country dives into a masonry wall of that country's POIs styled as photos, faux-video tiles (Ken Burns + runtime chrome) and Instagram-style posts; multi-select with a floating submit dock. Photos stream from the new keyless proxy `GET /api/home/poi-photo` (Google Places text-search + photo media, in-memory cached, gradient/emoji fallback)
  - **AI reasoning scene** — submitting opens `POST /api/home/itinerary` (public, per-IP rate-limited, SSE): the agent's pipeline renders live (analyze → cluster → LLM day-planning → solve → cost) with a step checklist and thought console. The endpoint reuses the production `solveItinerary` solver and routes the LLM call through `lib/llm` (taskClass `trip_generation`); every stage has a deterministic fallback in `services/home-demo/itinerary.ts`
  - **Itinerary scene** — the finished plan takes over with an animated map (real Google Map when `NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_API_KEY` is set, otherwise an animated SVG map with self-drawing day routes), auto-cycling day focus, and a dated day-by-day plan with arrive/depart times plus expected costs per stop/day/trip in local currency
  - Static bilingual POI catalog + shared types in `lib/home-survey.ts`; `services/decisions/places.ts` gains `findPlacePhotoName()`; docs surface updated (`guide-home-survey`, SAD feature entry, `api-home` group); old `plan-scene.tsx` hero retired
- **"Living Canvas" chat redesign** — a presentation-only reface of both chat surfaces toward a 2026, immersive, *context-first* feel (data flow, routes, and SSE pipeline unchanged):
  - New shared chat primitives under `components/app/chat/`: `chat-canvas` (perspective field with a pointer-parallaxed ambient-mesh backdrop behind always-crisp text), `chat-bubble` (depth/origin-aware spring entrances with real elevation; distinct mine/member/agent typography), `chat-composer` (floating glass command bar with auto-grow input + magnetic gradient send orb), `thinking-orb` (breathing aurora "reasoning" indicator that rotates context phrases — what the agent is thinking about), `proposal-card-3d` (the one foreground 3D object: a cursor-tilt glass card with pointer-tracking sheen that foregrounds the AI's *rationale* as hero copy), plus `streaming-text` (word-by-word blur→sharp reveal for live AI messages), `use-pointer-tilt`, and `use-live-message-ids`
  - `trip-group-chat.tsx` and `trip-chat-room.tsx` re-render through the shared primitives; the old flat bubbles, boxy textarea/Send, and dot pulse / `GridProposalCard` are retired
  - `app/globals.css` gains a "Living Canvas" block (chat mesh, depth bubbles, glass composer, send orb, breathing `gc-orb`) — all guarded by `prefers-reduced-motion` and `prefers-reduced-transparency`; the surface degrades to a clean, legible thread
  - No 3D library added — depth is CSS 3D transforms + pointer-tracked springs (Framer Motion), keeping the bundle lean
- **Chat-centric trip workspace** — the trip workspace is rebuilt around a shared group chat room as the primary surface; the AI planner (per-trip orchestrator) watches the conversation and proposes bento grids the group confirms:
  - New `group` thread kind on `trip_chat_threads` (singleton per trip) — `supabase/migrations/20260601000000_trip_chat_group_kind.sql` (enum value) + `20260601000001_trip_chat_group_thread.sql` (relaxed CHECK + unique index). The `threads` route opens/returns the singleton group room; the SSE `stream`, `read`, and `unread` routes work unchanged
  - Posting in the group room (`chat/threads/[threadId]/messages` POST, `kind='group'`) fires `wakeOrchestrator(tripId, "chat: …")` instead of a synchronous agent reply; the orchestrator may propose a grid via the existing propose-only `grids.add_agent` tool
  - `components/app/trip-group-chat.tsx` — full-height group chat room (multi-sender bubbles, SSE realtime, "AI planner is reading…" pulse) with inline grid-**proposal cards** sourced from pending `orchestrator_actions`; Confirm/Dismiss route through the existing `orchestrator/actions/[actionId]` endpoint and broadcast `GRIDS_CHANGED_EVENT`
  - `components/app/trip-grids-rail.tsx` — new right rail: confirmed grids on top (open in a grid panel), Trip-tools links, and a People section (member DMs + agent chats) below; replaces `trip-chat-navbar`
  - A conservative nudge in `services/orchestrator/runner.ts` tells the orchestrator to propose at most one matching grid when the chat reveals an ongoing tracking need
  - **Retired:** the 12-tile bento dashboard and the Bento↔Orchestrator mode toggle (`trip-bento-page`, `trip-orchestrator-mode`, `trip-workspace`, `workspace-mode`, `workspace-mode-toggle`, `trip-chat-navbar`); the individual `grids/*` components live on in the grid panel and feature routes
- **Drag a chat message → a grid** — any group-chat message can be turned into a bento grid by dragging it onto the grids rail, gated on an on-demand "agent-workable" check (you can only drag a message a defined agent can actually handle):
  - New `POST /api/app/trips/[tripId]/chat/classify` — runs an LLM (taskClass `extractor`) over the agent registry + trip context for a single message and returns `{ workable, agentType, title, config, confidence, reason }`; re-validates the model's pick against the registry and a confidence floor before allowing the drag
  - `components/app/chat/chat-bubble.tsx` gains optional drag affordance: hovering/focusing a human bubble lazily classifies it (cached per message in `trip-group-chat.tsx`); workable bubbles show a ⚡ chip and become `draggable`
  - The grids section of `trip-grids-rail.tsx` is now a drop target (native HTML5 DnD, MIME `application/x-chat-task` defined in `trip-workspace-events.ts`); dropping creates the `custom_grid` immediately, falling back to a **prefilled** `AddCustomGridDialog` when a required config field couldn't be derived
  - Desktop-only (native DnD has no touch), consistent with the existing board/bento drag patterns

- **Vibrant web app reface** — a visual redesign of the `/app` workspace toward a more modern, expressive look with micro-animations, structure unchanged:
  - `motion` (Framer Motion) added; `components/motion/` centralizes the motion vocabulary — `MotionProvider` (MotionConfig `reducedMotion="user"`), `variants.ts` (fadeUp / stagger / springPop / pageTransition), and reusable `Reveal`, `Stagger`/`StaggerItem`, `PageTransition`, `AnimatedNumber` helpers
  - `app/globals.css` gains a vibrant token layer: secondary accent axis (`--accent-warm`/`-cool`/`-violet`), gradient tokens (`--gradient-brand`/`-warm`/`-cool`/`-aurora`/mesh), glow shadows, re-saturated status colors, and utilities (`.btn-gradient`, `.text-gradient`, `.text-gradient-aurora`, `.tile-glow`, `.ambient-mesh`, `.chip-gradient`)
  - Fonts now load via `next/font` in `app/layout.tsx`: Space Grotesk (display), Inter (body), JetBrains Mono (numerics)
  - Chrome: `app-sidebar` uses `lucide-react` icons (replacing emoji) with a spring `layoutId` active pill and glass surfaces; `app-shell` renders an animated ambient mesh and per-route page transitions; the trip workspace tab underline glides via `layoutId`
  - Primitives restyled: `Button` (gradient variant + tactile feel), `Card` (rounded-3xl + optional `interactive` glow), `Badge` (gradient + status variants), `Input`/`Textarea` (animated focus glow), `Dialog` (blurred overlay, rounded surface)
  - Dashboard (`app/app/page.tsx`) and the shared `tab-shell` feature-page primitives now stagger in, use gradient display headings, and glow tiles
  - Bento grid tiles (`bento-frame`) are now frosted glass — translucent, backdrop-blurred surfaces over the shell's ambient mesh with a top highlight and accent-glow hover; falls back to an opaque surface under `prefers-reduced-transparency` or when `backdrop-filter` is unsupported
  - All motion honors `prefers-reduced-motion`

- **My Places (saved POIs)** — a private, per-user bookmark list of points of interest, independent of any trip:
  - `supabase/migrations/20260529000000_user_saved_pois.sql` — `user_saved_pois` table (owned by `line_user_id`, RLS denies anon, partial unique index on `(line_user_id, place_id)` for idempotent saves), plus `lib/app-pois.ts` shared types
  - `app/api/app/pois/route.ts` (`GET` list / `POST` save, idempotent on placeId) and `app/api/app/pois/[id]/route.ts` (`PATCH` notes/type/name, `DELETE`) — all ownership-scoped via the admin client
  - `app/app/pois/page.tsx` + `components/app/my-pois-client.tsx` — a new **我的地點 / My Places** page (sidebar nav entry added) with a saved-place list, per-place notes editing, delete, type filter, and a map of all saved pins
  - The map explorer's place detail now has a **☆ 儲存 / Save** action that adds curated POIs, route stops, and Google results to My Places (with already-saved state)
- **Map explorer** — the top-level `/app/map` view (`components/app/global-map-view.tsx`) is refactored from a read-only "all my places" map into a three-layer explorer with a destination selector:
  - **我的地點 (My places)** — the previous behaviour (trip pins, legend, type/stage filters, per-trip routes)
  - **探索 POI (Explore)** — curated `poi_embeddings` POIs for the selected destination (semantic free-text search) blended with live Google Places search
  - **路線 (Routes)** — curated `route_templates` rendered as an ordered pin sequence + polyline you can preview on the map
- `app/api/app/explore/pois/route.ts` — `GET` curated POI search by destination/query/types, surfacing the corpus that previously only fed trip generation
- `app/api/app/explore/routes/route.ts` — `GET` curated routes for a destination with `place_ids` resolved to coordinates for map rendering
- `searchPoisByText()` in `services/trip-generation/poi-engine.ts` and `listRoutesForDestination()` in `services/trip-generation/route-engine.ts` — explorer-facing wrappers (free-text vibe search; ungated route listing)
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

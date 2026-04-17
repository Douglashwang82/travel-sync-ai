# Travel Sync AI — Publish Readiness Plan

**Status:** ~70% production-ready. Core loops (voting, expense splitting) are solid; launch is blocked by security, observability, and travel-workflow completeness gaps.

**Audience:** Engineers picking up the launch-hardening work. Each task below has context, acceptance criteria, and concrete file pointers so work can start immediately.

**Execution order:** Phases are ordered by dependency and risk. Phase 0 is a hard blocker for any public launch. Phases 1–2 are required for stable production operation. Phases 3–6 close feature gaps across the group-travel lifecycle. Phase 7 is compliance/launch prep.

---

## Phase 0 — Launch Blockers (must fix before public release)

### 0.1 Wire outbound message retry into cron
- **Problem:** `retryFailedOutbound()` exists but is not invoked from any scheduled job. Vote-result messages and push notifications can fail silently.
- **Files:** `services/event-processor.ts`, `app/api/cron/process-events/route.ts`, `vercel.json`
- **Acceptance:**
  - Cron entry in `vercel.json` calls the retry path on schedule (≤5 min).
  - Failed outbound rows are picked up, retried with backoff, marked succeeded/failed.
  - Unit test covers success-after-retry and permanent-failure paths.

### 0.2 Verify vote postback handler
- **Problem:** `handlePostback()` path in `services/event-processor.ts` is flagged in `docs/TODO.md` as unverified; votes cast via Flex buttons may not persist.
- **Files:** `services/event-processor.ts`, `services/vote/index.ts`, `bot/router.ts`
- **Acceptance:**
  - End-to-end test: user taps Flex vote option → vote row inserted → tally updated → winner detected.
  - Logs show postback receipt, validation, and persistence.

### 0.3 Replace Next.js scaffold home page
- **Problem:** `app/page.tsx` still ships the default Next.js boilerplate.
- **Files:** `app/page.tsx`
- **Acceptance:**
  - Marketing/redirect page that either redirects to LINE add-friend URL or renders product landing.
  - No "Deploy to Vercel" / Next.js logo artifacts.

### 0.4 Audit Supabase RLS policies
- **Problem:** Most backend access uses the service role; RLS on user-facing tables is sparse. Current migrations show only minimal policies.
- **Files:** `supabase/migrations/`, any LIFF route under `app/api/liff/*`, `lib/db.ts`
- **Acceptance:**
  - Every table reachable from the browser-RLS client has explicit SELECT/INSERT/UPDATE/DELETE policies keyed to group/trip membership.
  - A new migration adds missing policies; documented in `docs/runbook.md`.
  - Policy tests added (pgTAP or integration tests using the anon key).

### 0.5 Enforce organizer-only destructive actions
- **Problem:** Any group member can delete trip items or cancel the trip.
- **Files:** `app/api/liff/items/route.ts`, `bot/commands/cancel.ts`, `bot/commands/complete.ts`, `services/trip-state/index.ts`
- **Acceptance:**
  - Delete/cancel/complete paths check `group_members.role === 'organizer'`.
  - Return 403 on LIFF; reply friendly error on bot.
  - Unit tests cover allow/deny paths.

---

## Phase 1 — Security & Reliability Hardening

### 1.1 Complete Zod validation coverage on LIFF routes
- **Files:** `app/api/liff/incidents/route.ts`, `app/api/liff/readiness/route.ts`, `app/api/liff/tracking/route.ts`, `app/api/liff/itinerary/route.ts`
- **Acceptance:** Every POST/PATCH body parsed through Zod. Malformed requests return 400 with structured error.

### 1.2 Generate typed Supabase client
- **Problem:** `lib/database.types.ts` contains unsafe `any` casts.
- **Files:** `lib/database.types.ts`, `lib/db.ts`, `package.json` (scripts)
- **Acceptance:**
  - `npm run db:types` regenerates types from Supabase.
  - `any` casts removed from all service files; `tsc` passes.

### 1.3 Expand E2E test coverage
- **Files:** `e2e/` (currently only `liff.spec.ts`), `playwright.config.ts`
- **Acceptance:** New Playwright specs for:
  - Vote lifecycle (start → cast → majority → confirm).
  - Expense lifecycle (record → split → settlement).
  - Incident open → resolve.
  - Readiness checklist complete → ready state.

### 1.4 Harden rate-limit fallback
- **Files:** `lib/rate-limit.ts`
- **Acceptance:** In-memory fallback is documented as single-instance only; production enforces DB-backed sliding window. Test confirms DB path is used when Supabase is reachable.

---

## Phase 2 — Observability & Operations

### 2.1 Structured JSON logging
- **Problem:** 13+ `console.log` / `console.error` sites in `lib/` with no schema; hard to query in production.
- **Files:** `lib/monitoring.ts` (extend), all `services/*`, cron handlers
- **Acceptance:**
  - `logger.info/warn/error` helper emits JSON (level, msg, traceId, groupId, tripId, userId).
  - All `console.*` in `lib/`, `services/`, `app/api/` replaced.
  - Integration with Sentry breadcrumbs.

### 2.2 Health & status endpoints
- **Files:** `app/api/health/route.ts` (new), `app/api/status/route.ts` (new)
- **Acceptance:**
  - `/api/health` returns 200 with DB + LINE + Gemini reachability checks.
  - `/api/status` returns queue depths, recent cron runs, circuit-breaker state.

### 2.3 Cron job failure alerting
- **Files:** `app/api/cron/*/route.ts`, `lib/monitoring.ts`
- **Acceptance:** Any cron job that fails emits Sentry event with cron name and context. Runbook entry lists on-call response.

### 2.4 Replace stub README with deployment docs
- **Files:** `README.md`, `docs/DEPLOYMENT.md` (new)
- **Acceptance:**
  - README covers: what the product is, local dev setup, test commands, deploy URL.
  - DEPLOYMENT.md covers: Vercel env vars, Supabase bootstrap, LINE channel setup, LIFF registration, cron secret rotation.

---

## Phase 3 — Planning Phase Feature Gaps

### 3.1 Budget tracking
- **Problem:** Budget is parsed from chat but never enforced; no "spent vs. planned" view.
- **Files:** `services/expenses/index.ts`, `services/parsing/extractor.ts`, `app/liff/expenses/page.tsx`, new migration for `trips.budget_amount`/`budget_currency`
- **Acceptance:**
  - `/start` or `/budget` can set a trip budget.
  - Expenses page shows % used, warns at 80%, blocks at 100% (or warns loudly).
  - Bot posts digest when budget threshold crossed.

### 3.2 Brainstorm board (structured ideation)
- **Files:** `bot/commands/idea.ts` (new), `app/liff/ideas/page.tsx` (new), migration for `trip_ideas`
- **Acceptance:** Group members can drop ideas (`/idea [text]`) that stack under destinations/themes before `/decide` promotes them to voting.

---

## Phase 4 — Pre-trip Preparation Feature Gaps

### 4.1 Travel documents tracking
- **Files:** new `bot/commands/docs.ts`, `app/liff/docs/page.tsx`, migration for `travel_documents`
- **Acceptance:**
  - Track passport expiry, visa status, insurance per member.
  - Nudge reminders at 6 months / 30 days pre-trip for expiring passports.

### 4.2 Packing checklist
- **Files:** `services/readiness/index.ts` (extend), `app/liff/readiness/page.tsx`
- **Acceptance:**
  - Destination-aware default packing list (weather, season) seeded from Gemini.
  - Per-member check-off, shown in readiness summary.

### 4.3 Booking confirmation ingestion
- **Files:** `bot/commands/share.ts` (extend), `services/parsing/extractor.ts`
- **Acceptance:**
  - Accept forwarded confirmation text / images; extract PNR, check-in time, reference number into trip items.
  - Booked items auto-flip to `confirmed` stage with reference stored.

---

## Phase 5 — In-trip Execution Feature Gaps

### 5.1 Daily itinerary push
- **Files:** `app/api/cron/daily-briefings/route.ts` (currently scaffold), `services/daily-briefing/index.ts`
- **Acceptance:**
  - Morning-of push in trip timezone lists today's confirmed items with times, addresses, map links.
  - Configurable send time per trip.

### 5.2 Transport monitoring completion
- **Problem:** `transport-monitor` cron exists; real alerting is incomplete.
- **Files:** `app/api/cron/transport-monitor/route.ts`, `services/tracking/*`
- **Acceptance:**
  - For each confirmed flight/train, poll status; push to group when delayed/cancelled/gate-changed.

### 5.3 Emergency contact card
- **Files:** `app/liff/readiness/page.tsx` (extend) or new `app/liff/emergency/page.tsx`
- **Acceptance:**
  - Per-destination: embassy phone, local emergency number, insurance hotline, nearest hospital.
  - Available offline (cached in LIFF).

### 5.4 Incident playbook completion
- **Problem:** `/incident` is scaffolded; playbooks stubbed.
- **Files:** `services/incidents/index.ts`, `bot/commands/incident.ts`
- **Acceptance:**
  - Concrete playbooks for: lost passport, flight delay/cancel, medical, theft, missed transfer.
  - Each playbook: immediate steps, contacts, doc templates, status tracking.

---

## Phase 6 — Expense & Post-trip Feature Gaps

### 6.1 Multi-currency expenses
- **Files:** `services/expenses/index.ts`, migration for `expense_currency` + daily FX snapshot
- **Acceptance:**
  - Record expense in any ISO currency; summary normalizes to trip base currency using per-day FX.
  - Settlement calculated in base currency.

### 6.2 Receipt image upload
- **Files:** `app/liff/expenses/page.tsx`, `services/expenses/index.ts`, Supabase Storage bucket
- **Acceptance:**
  - Attach image to expense; stored in Supabase Storage with signed URLs.
  - Optional Gemini Vision extraction of amount/merchant to pre-fill fields.

### 6.3 Final settlement push & confirmation
- **Files:** `services/expenses/index.ts`, new cron for trip-complete settlement nudges
- **Acceptance:** When trip marked `complete`, bot posts final settlement with per-person transfer instructions. Members confirm paid → balances close.

### 6.4 Post-trip recap
- **Files:** `app/liff/recap/page.tsx` (new), `services/memory/index.ts`
- **Acceptance:**
  - Trip recap view: timeline of confirmed items, expense summary, photos from `trip_memories`.
  - Shareable link back into LINE.

### 6.5 Trip feedback collection
- **Files:** new command/flow post-complete
- **Acceptance:** On `/complete`, bot DMs each member a 1-tap NPS + free-text; results stored for product analytics.

---

## Phase 7 — Compliance & Launch Prep

### 7.1 Privacy policy & terms of service
- **Files:** `app/(marketing)/privacy/page.tsx`, `app/(marketing)/terms/page.tsx`
- **Acceptance:** Published pages linked from README, LINE channel description, and LIFF footer. Covers data retention, LINE/Gemini/Google API data flow, GDPR-lite rights.

### 7.2 Data retention & deletion
- **Files:** `app/api/cron/cleanup/route.ts` (extend), new `/api/user/delete` or equivalent
- **Acceptance:**
  - Retention windows documented (events, parsed entities, analytics).
  - User-triggered account/data deletion path that cascades to trips they organize.

### 7.3 Admin/organizer console (internal)
- **Files:** `app/admin/*` (new, auth-gated)
- **Acceptance:** Ops-side view: list trips, inspect queue depth, reprocess failed events, disable a noisy group.

### 7.4 Load & soak test
- **Acceptance:** k6 or Artillery script simulating 100 concurrent groups × 10 msg/min for 30 min without error-rate spike; results documented.

### 7.5 Launch checklist dry-run
- **Acceptance:** Go-live runbook executed in staging: LINE webhook verified, cron secrets rotated, Sentry release tagged, Supabase backup scheduled, on-call rotation set.

---

## Travel Workflow Coverage — At a Glance

| Phase | Current | Target After Plan |
|---|---|---|
| Inspiration / Ideation | Partial | Present (3.2) |
| Planning (dates/budget) | Partial | Present (3.1) |
| Decision / Voting | Present | Present |
| Booking | Partial | Present (4.3) |
| Pre-trip Prep | Partial | Present (4.1, 4.2) |
| In-trip Execution | Partial | Present (5.1–5.3) |
| Disruption Handling | Partial | Present (5.4) |
| Expense Management | Present | Extended (6.1, 6.2) |
| Communication | Partial | Present (2.x observability) |
| Post-trip | Partial | Present (6.3–6.5) |

---

## Suggested Sequencing

- **Week 1:** Phase 0 in full.
- **Week 2:** Phase 1 + start Phase 2.
- **Week 3–4:** Finish Phase 2; start Phase 3 and Phase 4 in parallel.
- **Week 5–6:** Phase 5.
- **Week 7:** Phase 6.
- **Week 8:** Phase 7, staging soak, public launch.

Each task should land as its own PR with tests. Keep `docs/CHANGELOG.md` updated per phase.

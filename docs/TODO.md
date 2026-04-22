# TODO

A prioritized task list for the TravelSync AI project. Add new tasks under the appropriate section and move completed items to Done.

---

## Critical (Blocker for Launch)

- [ ] **Create `.env.example`** — Document all required env vars (from `lib/env.ts`) so new contributors can bootstrap the project without guessing.
- [ ] **Wire outbound message retry** — Audit `lib/line.ts` `pushText()`/`pushFlex()` and confirm `retryFailedOutbound()` is invoked by the cron sweeper; silent failures break vote results delivery.
- [ ] **Verify vote postback handler** — Confirm `handlePostback()` in `services/event-processor.ts` fully handles the `vote|itemId|optionId` format end-to-end; write a manual test or integration test.

---

## High Priority (Pre-Beta)

- [ ] **Replace boilerplate home page** — `app/page.tsx` is the default Next.js scaffold; replace with a proper landing page or redirect to the LIFF dashboard.
- [ ] **Generate Supabase TypeScript types** — Run `npx supabase gen types typescript --local > lib/database.types.ts` and use throughout the codebase to eliminate unsafe `any` casts.
- [ ] **Organizer-only item actions** — Add role check (organizer vs. member) before allowing delete/reopen on LIFF item sheets; currently any group member can delete trip items.
- [ ] **Richer vote winner announcement** — Replace plain-text `buildWinnerMessage()` stub in `services/decisions/flex.ts` with a proper Flex Message bubble matching the vote carousel style.
- [ ] **LIFF auth error state** — Add a graceful error screen when LINE Login fails so users don't see a blank screen.

---

## Medium Priority (Quality & Polish)

- [ ] **Web vote LINE chat reliability** — Web-cast votes now call `refreshVoteCarousel` / `announceWinner` fire-and-forget (errors are swallowed). Add structured logging + a retry queue so LINE message failures are observable and retried rather than silently dropped. Also add an integration test that mocks `pushFlex`/`pushText` and asserts they are called after a web cast.
- [ ] **Real-time LIFF updates** — Replace polling in the dashboard with Supabase real-time subscriptions so vote counts and board changes update live across users.
- [ ] **Clarify vote majority threshold** — Document and harden the `groupSize / 2` threshold in `services/vote/index.ts`; verify tie handling at even group sizes (e.g., 4-person group at 2-2).
- [ ] **Structured logging** — Add JSON-structured logs (e.g., with Axiom or a lightweight wrapper) across webhook, cron, and parsing services for production observability.
- [ ] **Improve LIFF error messages** — Replace generic "Failed to load" messages in LIFF API routes with actionable, user-readable descriptions.
- [ ] **Google Places fallback options** — Add a small set of pre-cached or organizer-prompted fallback options when `GOOGLE_PLACES_API_KEY` is missing or returns no results.
- [ ] **Expand conflict detection** — Extend `services/parsing/conflict.ts` to catch preference contradictions (e.g., "no seafood" vs. "sushi only"), not just date conflicts.
- [ ] **Update README.md** — Replace the default Next.js README with project-specific setup instructions, architecture overview, and deployment steps.

---

## Low Priority (Nice to Have)

- [ ] **Internal analytics dashboard** — Build a simple read-only page (admin-only) to visualize `analytics_events` trends (bot additions, votes cast, nudge conversion rates).
- [ ] **Bulk item operations on LIFF** — Allow moving or deleting multiple items at once from the board view.
- [ ] **Increase parsing context window** — Raise the 10 recent entities / 5 open items limit in `services/parsing/context.ts` for longer trips where early items risk being forgotten.
- [ ] **`/nudge` command cleanup** — Review `bot/commands/nudge.ts` for edge cases when the group has no open To-Do items.

---

## Post-MVP Features (Backlog)

- [ ] Drag-to-reorder itinerary timeline in LIFF
- [ ] Itinerary PDF export and calendar sync (.ics)
- [ ] OTA affiliate deep links (Booking.com, Klook, KKday) on confirmed items
- [ ] Smart bill splitting — split expenses among group members
- [ ] Flight monitoring — alert group when booked flight price changes
- [ ] Multi-language support (Japanese in addition to Chinese/English)
- [ ] Repeat trip templates — save and reuse a past trip's structure
- [ ] On-trip contextual suggestions (weather, local events near destination)

---

## Done

<!-- Move completed tasks here with a completion date -->


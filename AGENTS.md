<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# LINE bot architecture — invariants

Read these before proposing changes to webhook, event, or outbound code. Most "let's add X" ideas turn out to already exist.

- **Single inbound endpoint:** `app/api/line/webhook/route.ts`. Verifies signature, persists every event to `line_events` (idempotent via `line_event_uid`), returns 200 in <1s, schedules processing via Next.js `after()`.
- **Single dispatcher:** `services/event-processor.ts` routes by `(event.type, source.type)`. DM detection: `lineGroupId === userId`. Slash commands: `text.startsWith("/")` → `bot/router.ts`. Free text in groups → `services/parsing/` (the "group monitor"). Free text in 1:1 → `services/private-chat/` (LLM reasoning, already wired to Gemini).
- **Single outbound chokepoint:** `lib/line.ts`. Never call `@line/bot-sdk` directly outside this file (CLI scripts in `scripts/` are the only exception). All pushes are tracked in `outbound_messages` with retry + backoff.
- **Durable queue = `line_events` table.** No external queue lib. Webhook fast-path is `after()`; the `process-events` cron (`app/api/cron/process-events/route.ts`) is the recovery sweeper for crashed workers, stalled `processing` rows (>5 min), and `failed` rows whose `next_retry_at` has elapsed. Backoff: `2^(retry_count+1)s`, capped at 1h, via `computeNextRetryAt` in `services/event-processor.ts`.
- **Postbacks are not commands.** They live in `services/event-processor.ts` `handlePostback`, keyed on a `prefix|...` data scheme.
- **Notifications are event-sourced**, not cron-driven. `services/notifications/index.ts` exposes `notifyXxx()` wrappers; crons handle reminders/digests, not the primary delivery path.

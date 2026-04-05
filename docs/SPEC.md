# TravelSync AI — Specification

> Source of truth for implementation. Derived from `prd-travel-sync-ai.md` and `system-design-travel-sync-ai-mvp.md`.

## Product

LINE-native group travel planning bot. Parses group chat, maintains a three-stage trip board (To-Do → Pending → Confirmed), and drives group decisions via Flex Message voting cards. Users never leave LINE.

## Architecture

Single Next.js app on Vercel + Supabase. Three surfaces:

1. **Webhook** — `POST /api/line/webhook`: validate signature → persist event → 200 OK → async process
2. **LIFF Web App** — Dashboard (board), Itinerary (confirmed timeline), Help
3. **Internal APIs** — `/api/liff/*` endpoints serving the LIFF pages

## Bot Commands (MVP)

| Command | Description |
|---------|-------------|
| `/start [destination] [dates]` | Initialize trip, set destination and date range |
| `/vote [item]` | Trigger visual vote for a board item |
| `/status` | Show item counts and list per stage |
| `/nudge` | Remind non-voters and stale-item owners |
| `/add [item]` | Manually add a To-Do item |
| `/help` | List all commands |

## Data Model Summary

See `system-design-travel-sync-ai-mvp.md` §7 for full schema.

Primary tables: `line_groups`, `group_members`, `trips`, `trip_items`, `trip_item_options`, `votes`, `parsed_entities`, `line_events`, `raw_messages`, `outbound_messages`, `analytics_events`.

Trip item lifecycle: `todo` → `pending` → `confirmed`

## Analytics Events

`bot_added_to_group`, `trip_created`, `message_parsed`, `vote_initiated`, `vote_cast`, `vote_completed`, `liff_opened`, `nudge_sent`, `nudge_conversion`, `bot_removed`

## Performance Targets

| Requirement | Target |
|-------------|--------|
| Webhook response | < 1s |
| Bot command response | < 2s |
| Chat parsing (background) | < 3s |
| LIFF load | < 2s |

## Environment Variables Required

```
LINE_CHANNEL_SECRET=
LINE_CHANNEL_ACCESS_TOKEN=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SECRET_KEY=
GEMINI_API_KEY=
GOOGLE_PLACES_API_KEY=
LIFF_ID=
```

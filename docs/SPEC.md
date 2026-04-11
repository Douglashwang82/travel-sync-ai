# TravelSync AI — Specification

> Source of truth for implementation. Derived from `prd-travel-sync-ai.md` and `system-design-travel-sync-ai-mvp.md`.

## Product

LINE-native group travel planning bot. Parses group chat, maintains a three-stage trip board (To-Do → Pending → Confirmed), and drives group decisions via Flex Message voting cards. Users never leave LINE.

## Architecture

Single Next.js app on Vercel + Supabase. Three surfaces:

1. **Webhook** — `POST /api/line/webhook`: validate signature → persist event → 200 OK → async process
2. **LIFF Web App** — Dashboard (board), Itinerary (confirmed timeline), Help
3. **Internal APIs** — `/api/liff/*` endpoints serving the LIFF pages

## Bot Commands

| Command | Description |
|---------|-------------|
| `/start [destination] [dates]` | Initialize trip, set destination and date range |
| `/status` | Show item counts and list per stage |
| `/decide [item]` | Create a decision item so the group can vote on it later |
| `/option [decision-item] \| [option-name]` | Add a manual voting option to a decision item |
| `/vote [item]` | Open voting for a decision item; fetches options from memory then Google Places |
| `/add [item]` | Add a planning task to the To-Do board |
| `/share [url]` | Save a hotel, restaurant, flight, or activity link as trip knowledge |
| `/recommend [type]` | Surface remembered places from the group's chat history |
| `/ready` | Show a readiness summary using confirmed trip details only |
| `/ops` | Show the trip operations summary based on confirmed execution data |
| `/incident [what happened]` | Open a verified incident playbook for disruptions |
| `/nudge` | Remind non-voters and groups with stale To-Do items |
| `/exp [amount] [description] [for @name1 @name2 \| for all]` | Record a payment and split it |
| `/exp-summary` | Show minimum settlements (who owes whom) |
| `/optout` | Stop TravelSync from parsing a user's messages |
| `/optin` | Re-enable message parsing after opting out |
| `/help` | List all commands |

### Decision flow

```
/decide restaurant          → creates "Choose restaurant" decision item (stage: todo)
/option restaurant | Foo    → manually adds "Foo" as a voteable option
/vote restaurant            → opens voting; auto-fetches options from memory / Places API,
                              merges with any manually added options
```

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

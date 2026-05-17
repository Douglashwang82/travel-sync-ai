# Japan Ski Trip — Niseko dataset

Initial curated dataset of points-of-interest for a Niseko ski trip.
Intended as seed data for trip generation, templates, and decision options.

## Files

| File | Contents |
|---|---|
| `resorts.json` | The five ski areas around Niseko (4 Niseko United + Moiwa) plus pass info. |
| `hotels.json` | Curated lodging across the four resort bases, split by price band. |
| `transport.json` | Airport gateways, inbound coach/train/rental options, in-resort shuttles. |
| `restaurants.json` | Notable restaurants and bars in Hirafu, Hanazono and Niseko Village. |
| `activities.json` | Onsens, snow activities, ski schools, guided backcountry, sightseeing. |

## Schema conventions

Records share a common shape that maps to the `trip_template_items`
columns in the database (see `supabase/migrations/20260422000000_trip_templates.sql`):

- `id` — stable string slug, safe for cross-file references
- `name`, `name_ja` — English and Japanese display names
- `address`, `lat`, `lng` — postal address + WGS-84 coordinates
- `website` / `booking_url` — external URL (maps to `external_url`)
- `notes` — short free-text description (maps to `notes`)
- `indicative_price_jpy` — best-effort price snapshot; verify before booking

Categories add their own typed fields (e.g. `lifts`, `courses`,
`vertical_m` on resorts; `cuisine`, `price_band` on restaurants).

`item_type` mapping when ingested as a template item:

| Dataset file | `trip_items.item_type` |
|---|---|
| `hotels.json` | `hotel` |
| `restaurants.json` | `restaurant` |
| `activities.json` | `activity` |
| `transport.json` | `transport` |
| `resorts.json` | `activity` |

## Caveats

- All prices are **indicative 2024/25** values and will drift; treat as planning hints, not quotes.
- Coordinates were sourced from public maps; expect ±50 m accuracy.
- The dataset is small by design — it is a starting point, not an exhaustive index. Extend by adding entries to the relevant file, keeping the field shape consistent.

# TravelSync AI v1.2 Google Integration Roadmap

## Purpose

Turn the high-level Google API recommendations into a repo-specific implementation plan that fits the current TravelSync AI architecture:

- LINE-first bot and LIFF experience
- Next.js monolith on Vercel
- Supabase as the operational store
- Gemini already in use for extraction and summarization
- v1.2 execution-stage features still being scaffolded

This roadmap focuses on Google integrations that directly support the app's core jobs:

1. capture and normalize trip knowledge
2. enrich confirmed itinerary items
3. generate practical daily and phase-aware operational guidance
4. provide lightweight visual and export utilities

It intentionally does not treat Google as the primary transport-status provider for live flight disruption alerts. That part should use a dedicated aviation or transport provider.

## Current Repo Fit

The existing codebase already gives us good anchor points:

- [lib/gemini.ts](E:\Projects\travel-sync-ai\lib\gemini.ts): Gemini client wrapper and circuit breaker
- [services/decisions/places.ts](E:\Projects\travel-sync-ai\services\decisions\places.ts): Google Places text search integration already exists
- [services/share/extractor.ts](E:\Projects\travel-sync-ai\services\share\extractor.ts): Gemini-powered shared-link extraction
- [services/memory/index.ts](E:\Projects\travel-sync-ai\services\memory\index.ts): trip memory and recommendations
- [services/operations/index.ts](E:\Projects\travel-sync-ai\services\operations\index.ts): operations summary composition
- [services/readiness/index.ts](E:\Projects\travel-sync-ai\services\readiness\index.ts): readiness heuristics
- [services/daily-briefing/index.ts](E:\Projects\travel-sync-ai\services\daily-briefing\index.ts): daily briefing scaffold
- [app/api/cron/transport-monitor/route.ts](E:\Projects\travel-sync-ai\app\api\cron\transport-monitor\route.ts): transport-monitor scaffold
- [app/api/cron/daily-briefings/route.ts](E:\Projects\travel-sync-ai\app\api\cron\daily-briefings\route.ts): daily-briefing scaffold

## Recommended Google API Stack

### Tier 1: Build Now

1. Places API
2. Routes API
3. Weather API

### Tier 2: Optional Product Upgrades

1. Calendar API
2. Static Maps API

### Tier 3: Skip for v1.2

1. Google as the main live flight-status source
2. Drive or Docs style document workflows
3. OCR-heavy Google Vision workflows

## Guiding Rules

### 1. Use cheap lookup patterns first

For Google Maps Platform, cost is often determined by which fields are requested, not just which endpoint is called.

That means:

- use autocomplete or ID-first search for candidate selection
- fetch richer details only after the user or system chooses a place
- do not request ratings, price levels, or photos unless they materially improve the UX

### 2. Store normalized references once

External Google lookups should enrich stored trip records rather than being re-run every time a user opens LIFF or uses a command.

### 3. Keep critical ops deterministic

Google APIs should improve context and convenience, not become a hard dependency for:

- `/ops`
- `/ready`
- daily briefing delivery
- incident guidance

If Google data is unavailable, the product should fall back to confirmed trip data and explicit unknown states.

## Phase Plan

## Phase 0: Refactor Existing Places Usage

### Goal

Reduce cost risk in the current Google Places integration before broader usage grows.

### Why now

The current field mask in [services/decisions/places.ts](E:\Projects\travel-sync-ai\services\decisions\places.ts) requests:

- `places.displayName`
- `places.formattedAddress`
- `places.rating`
- `places.priceLevel`
- `places.photos`

That pattern can move requests into more expensive Places SKUs than needed for a simple candidate list.

### Changes

#### Code

- split place search into two steps:
  - candidate search
  - detail enrichment
- add a new module:
  - `services/google/places.ts`
- keep [services/decisions/places.ts](E:\Projects\travel-sync-ai\services\decisions\places.ts) as a thin consumer or adapter

#### Search behavior

- for candidate lists, return only:
  - place ID
  - display name
  - optionally formatted address
- fetch photos, rating, and richer metadata only after:
  - the organizer opens a candidate detail
  - the app confirms a selected option
  - a confirmed option needs LIFF presentation enrichment

#### Product impact

- lower cost per search
- better quota headroom
- easier caching strategy

### Estimated effort

- 0.5 to 1 day

## Phase 1: Places API as the Knowledge and Enrichment Backbone

### Goal

Use Places API as the canonical venue lookup layer for hotels, restaurants, and activities.

### Primary flows

1. organizer searches for candidate places
2. organizer confirms one option
3. app stores stable Google place identity and lightweight details
4. itinerary and ops views render from stored data

### Implementation

#### New service boundary

- `services/google/places.ts`

Suggested functions:

- `searchPlaceCandidates(input)`
- `getPlaceDetails(placeId)`
- `getPlacePhotoUrl(photoName)`
- `normalizePlaceToOption(details)`

#### Call sites

- place suggestion flows under `services/decisions/`
- LIFF itinerary enrichment
- shared-link consolidation in [services/share/extractor.ts](E:\Projects\travel-sync-ai\services\share\extractor.ts)
- memory normalization in [services/memory/index.ts](E:\Projects\travel-sync-ai\services\memory\index.ts)

### Schema changes

#### Existing table changes

`trip_item_options`

Add or formalize Google-specific metadata for confirmed and candidate options:

- `provider = 'google_places'` is already supported by type
- use `external_ref` to store Google `place_id`
- add `source_last_synced_at timestamptz null`
- add `lat double precision null`
- add `lng double precision null`
- add `google_maps_url text null`
- add `photo_name text null`
- add `editorial_summary text null`
- add `opening_hours_json jsonb null`

`trips`

- keep `destination_place_id`
- consider adding `destination_lat double precision null`
- consider adding `destination_lng double precision null`
- consider adding `destination_timezone text null`

### Env vars

Required:

- `GOOGLE_PLACES_API_KEY`

Optional split-key setup for future hardening:

- `GOOGLE_MAPS_SERVER_API_KEY`
- `GOOGLE_PLACES_API_KEY`

If you keep one server-side key for all Maps Platform calls, that is acceptable for v1.2.

### Usage and cost expectations

Recommended usage pattern:

- search when organizer actively looks for places
- detail fetch only when a place is selected or promoted into itinerary
- photo fetch only in LIFF detail-heavy views

Expected early-stage usage:

- low to medium search volume
- much lower detail volume
- lower still photo volume

Planning assumption for monthly modeling:

- 25,000 autocomplete-like candidate requests
- 8,000 place detail calls
- 5,000 photo requests

That pattern is much safer than running 25,000 high-field text searches.

### Estimated effort

- 2 to 4 days

## Phase 2: Routes API for Operational Timing

### Goal

Use Google Routes to improve readiness, daily briefings, and incident guidance with practical travel-time estimates.

### Best-fit product jobs

- airport to hotel transfer timing
- hotel to activity travel timing
- meetup leave-by reminders
- same-day transfer risk detection

### Implementation

#### New service boundary

- `services/google/routes.ts`

Suggested functions:

- `computeRoute(input)`
- `computeLeaveByTime(input)`
- `summarizeTransferRisk(input)`

#### Main integration points

- [services/operations/index.ts](E:\Projects\travel-sync-ai\services\operations\index.ts)
- [services/readiness/index.ts](E:\Projects\travel-sync-ai\services\readiness\index.ts)
- [services/daily-briefing/index.ts](E:\Projects\travel-sync-ai\services\daily-briefing\index.ts)
- [services/incidents/index.ts](E:\Projects\travel-sync-ai\services\incidents\index.ts)

### Schema changes

Add a materialized route cache table:

`trip_route_snapshots`

Suggested columns:

- `id uuid primary key`
- `trip_id uuid not null references trips(id) on delete cascade`
- `origin_label text not null`
- `origin_lat double precision not null`
- `origin_lng double precision not null`
- `destination_label text not null`
- `destination_lat double precision not null`
- `destination_lng double precision not null`
- `travel_mode text not null`
- `departure_time timestamptz null`
- `duration_seconds integer not null`
- `distance_meters integer not null`
- `duration_in_traffic_seconds integer null`
- `provider text not null default 'google_routes'`
- `provider_payload_json jsonb not null default '{}'::jsonb`
- `computed_at timestamptz not null default now()`
- `expires_at timestamptz null`

Why cache this:

- keeps `/ops` and LIFF fast
- avoids recomputing the same route repeatedly
- makes cron-generated daily briefings cheaper and more predictable

### Env vars

Required:

- `GOOGLE_ROUTES_API_KEY`

If you use a single Maps Platform key:

- `GOOGLE_MAPS_SERVER_API_KEY`

### Usage and cost expectations

Recommended usage pattern:

- compute routes in cron or on important state changes
- do not calculate on every LIFF page view
- refresh route estimates near departure or same-day execution windows

Planning assumption for monthly modeling:

- 20,000 route calculations

This should stay manageable if route generation is materialized and reused.

### Estimated effort

- 2 to 3 days

## Phase 3: Weather API for Daily Briefings and Incident Context

### Goal

Add weather context to daily briefing and disruption guidance without making the product weather-dependent.

### Best-fit product jobs

- morning briefing context
- rain or wind heads-up for major activity days
- airport transfer and departure-day caution
- packing nudges

### Implementation

#### New service boundary

- `services/google/weather.ts`

Suggested functions:

- `getTripDayWeather(input)`
- `getDepartureWindowWeather(input)`
- `summarizeOperationalWeatherRisk(input)`

#### Main integration points

- [services/daily-briefing/index.ts](E:\Projects\travel-sync-ai\services\daily-briefing\index.ts)
- [services/incidents/index.ts](E:\Projects\travel-sync-ai\services\incidents\index.ts)
- [services/operations/index.ts](E:\Projects\travel-sync-ai\services\operations\index.ts)

### Schema changes

Add a weather cache table:

`trip_weather_snapshots`

Suggested columns:

- `id uuid primary key`
- `trip_id uuid not null references trips(id) on delete cascade`
- `snapshot_date date not null`
- `lat double precision not null`
- `lng double precision not null`
- `provider text not null default 'google_weather'`
- `summary text null`
- `temperature_min_c numeric(5,2) null`
- `temperature_max_c numeric(5,2) null`
- `precipitation_probability numeric(5,2) null`
- `wind_speed_kph numeric(6,2) null`
- `severe_flag boolean not null default false`
- `provider_payload_json jsonb not null default '{}'::jsonb`
- `fetched_at timestamptz not null default now()`
- `expires_at timestamptz null`

Indexes:

- `(trip_id, snapshot_date)`

### Env vars

Required:

- `GOOGLE_WEATHER_API_KEY`

If consolidated:

- `GOOGLE_MAPS_SERVER_API_KEY`

### Usage and cost expectations

Recommended usage pattern:

- daily cron fetch for active trips
- optional manual refresh by organizer
- no need to re-fetch constantly during normal usage

Planning assumption for monthly modeling:

- 30,000 weather requests

This is a low-cost integration relative to its user value.

### Estimated effort

- 1 to 2 days

## Phase 4: Calendar API for Export and Personal Convenience

### Goal

Offer optional export of confirmed itinerary items into Google Calendar.

### Why optional

This is useful, but not central to the trip-operations product promise. It should not delay Places, Routes, or Weather.

### Product scope for v1.2

Only support:

- export confirmed itinerary items
- create a dedicated trip calendar or add to organizer-owned calendar
- per-user opt-in sync

Do not support in v1.2:

- full two-way sync
- conflict resolution across multiple users
- organizer editing everyone else's personal calendar

### Implementation

#### New service boundary

- `services/google/calendar.ts`

Suggested functions:

- `createTripCalendar(input)`
- `upsertCalendarEvent(input)`
- `syncConfirmedTripItemsToCalendar(input)`

#### Main integration points

- LIFF settings or organizer tools page
- itinerary export action

### Schema changes

Add integration state table:

`user_google_connections`

Suggested columns:

- `id uuid primary key`
- `user_id text not null`
- `google_subject text not null`
- `access_token_encrypted text not null`
- `refresh_token_encrypted text not null`
- `token_expires_at timestamptz null`
- `scope text[] not null`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Add calendar mapping table:

`trip_calendar_syncs`

Suggested columns:

- `id uuid primary key`
- `trip_id uuid not null references trips(id) on delete cascade`
- `line_user_id text not null`
- `google_calendar_id text not null`
- `sync_status text not null default 'active'`
- `last_synced_at timestamptz null`
- `created_at timestamptz not null default now()`

Add event mapping table:

`trip_calendar_events`

Suggested columns:

- `id uuid primary key`
- `trip_id uuid not null references trips(id) on delete cascade`
- `trip_item_id uuid not null references trip_items(id) on delete cascade`
- `line_user_id text not null`
- `google_calendar_event_id text not null`
- `last_exported_at timestamptz not null default now()`
- `source_hash text not null`

### Env vars

Required for OAuth flow:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`

Optional:

- `GOOGLE_CALENDAR_SYNC_ENCRYPTION_KEY`

### Usage and cost expectations

- Calendar API itself is not the cost concern
- the main cost is implementation complexity and support burden

### Estimated effort

- 3 to 5 days

## Phase 5: Static Maps for Lightweight Visual Context

### Goal

Render simple map previews in LIFF for itinerary items and meetup context.

### Best use cases

- itinerary card map thumbnails
- meetup point previews
- airport to hotel orientation

### Why this is lower priority

The app does not need a full map-centric product experience. Static images are enough for most operational contexts.

### Implementation

- add a helper module:
  - `services/google/static-maps.ts`
- use stored lat and lng from place enrichment
- only render when coordinates exist

### Schema changes

No new table required if coordinates are stored on `trip_item_options` and destination fields.

### Env vars

Required:

- `GOOGLE_STATIC_MAPS_API_KEY`

Or reuse:

- `GOOGLE_MAPS_SERVER_API_KEY`

### Estimated effort

- 0.5 to 1 day

## Non-Google Dependency for Transport Monitoring

### Important decision

Do not plan the transport-monitoring milestone around a Google API.

For [app/api/cron/transport-monitor/route.ts](E:\Projects\travel-sync-ai\app\api\cron\transport-monitor\route.ts), use a dedicated provider abstraction:

- `services/transport/providers/*.ts`

Suggested interface:

- `fetchTransportStatus(reference)`
- `normalizeTransportStatus(response)`
- `diffTransportStatus(previous, current)`

Suggested schema additions:

`trip_transport_monitors`

- `reference_type text not null`
- `reference_value text not null`
- `provider text not null`
- `provider_external_ref text null`
- `status_json jsonb not null default '{}'::jsonb`
- `last_checked_at timestamptz null`
- `last_changed_at timestamptz null`
- `monitor_state text not null default 'active'`
- `degraded_reason text null`

`trip_transport_alerts`

- `monitor_id uuid not null references trip_transport_monitors(id) on delete cascade`
- `alert_type text not null`
- `severity text not null`
- `title text not null`
- `body text not null`
- `dedupe_key text not null`
- `created_at timestamptz not null default now()`

This keeps Google integrations focused on enrichment and operations context while allowing the monitoring layer to use the provider that best fits flight or rail coverage.

## Proposed Env File Expansion

Add these to [.env.example](E:\Projects\travel-sync-ai\.env.example) as commented staged options:

```env
# Google Maps Platform - unified server-side key (preferred for v1.2)
GOOGLE_MAPS_SERVER_API_KEY=

# Or split service keys if you want separate quotas and restrictions
GOOGLE_PLACES_API_KEY=
GOOGLE_ROUTES_API_KEY=
GOOGLE_WEATHER_API_KEY=
GOOGLE_STATIC_MAPS_API_KEY=

# Google OAuth - only needed for Calendar export/sync
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=
GOOGLE_CALENDAR_SYNC_ENCRYPTION_KEY=
```

Recommended v1.2 rollout:

1. keep `GEMINI_API_KEY`
2. add one unified Maps Platform server-side key first
3. split keys only if quota management or security boundaries become a real need

## Proposed Service Layout

Suggested new directories:

```text
services/
  google/
    places.ts
    routes.ts
    weather.ts
    calendar.ts
    static-maps.ts
  transport/
    providers/
      index.ts
      <non-google-provider>.ts
```

Suggested supporting utility:

```text
lib/
  google-maps.ts
```

Possible responsibilities for `lib/google-maps.ts`:

- shared fetch wrapper
- retry and timeout policy
- quota-aware logging
- request correlation IDs

## Migration Sequence

Recommended database migration order:

1. extend `trip_item_options` for Google place metadata
2. extend `trips` for destination coordinates and timezone
3. add `trip_route_snapshots`
4. add `trip_weather_snapshots`
5. add `trip_transport_monitors`
6. add `trip_transport_alerts`
7. add Calendar sync tables only if Phase 4 is approved

This order supports shipping the highest-value operational features first without forcing OAuth or sync work early.

## Testing Plan

### Unit tests

- place result normalization
- detail caching behavior
- route leave-by calculations
- weather risk summarization
- transport alert dedupe

### Integration tests

- `/ops` includes route and weather context when cache exists
- `/ready` stays functional when Google APIs fail
- daily briefing cron uses cached weather and route data

### Failure-mode tests

- Google key missing
- provider timeout
- empty place results
- route computation unavailable
- weather fetch degraded

The expected behavior should be:

- no crash
- explicit degraded note
- deterministic fallback output

## Delivery Recommendation

### Sprint 1

- Phase 0
- Phase 1

### Sprint 2

- Phase 2
- Phase 3

### Sprint 3

- non-Google transport monitoring
- alert dedupe
- incident integration

### Sprint 4

- optional Calendar export
- optional Static Maps

## Summary

The repo is already well-positioned for a staged Google integration strategy.

The best sequence is:

1. fix the cost shape of Places usage
2. make Places the normalized venue backbone
3. add Routes for operational timing
4. add Weather for daily briefings and incident context
5. keep Calendar and Static Maps optional
6. use a non-Google provider for live transport monitoring

That path supports the actual product intention of TravelSync AI without overbuilding, overpaying, or tying mission-critical trip execution to the wrong external dependency.

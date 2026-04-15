# TravelSync AI v1.2 Task Breakdown

## Phase 0: Alignment

- [ ] T0.1 Finalize `prd-travel-sync-ai-v1.2.md`
- [ ] T0.2 Finalize `system-design-travel-sync-ai-v1.2.md`
- [ ] T0.3 Confirm v1.2 release slice and success metrics

## Phase 1: Schema and Scaffolding

- [ ] T1.1 Add migration for `trip_readiness_items`
- [ ] T1.2 Add migration for `trip_transport_monitors`
- [ ] T1.3 Add migration for `trip_transport_alerts`
- [ ] T1.4 Add migration for `trip_incidents`
- [ ] T1.5 Add migration for `trip_incident_events`
- [ ] T1.6 Add migration for `trip_daily_briefings`
- [ ] T1.7 Add service modules for operations, readiness, alerts, incidents, and briefings
- [ ] T1.8 Add LIFF route scaffolds for operations and readiness
- [ ] T1.9 Add cron route scaffolds for readiness refresh, daily briefings, transport monitor, and incident follow-up
- [ ] T1.10 Refactor Google Places usage into search-first and detail-on-selection flows
- [ ] T1.11 Add shared Google service wrappers under `services/google/`
- [ ] T1.12 Add env var definitions and runtime validation for Maps Platform integrations

## Phase 2: Readiness MVP

- [ ] T2.1 Define readiness categories and severity model
- [ ] T2.2 Implement readiness generation from trip and confirmed items
- [ ] T2.3 Implement readiness item status transitions
- [ ] T2.4 Add `/ready` command handler
- [ ] T2.5 Implement `GET /api/liff/readiness`
- [ ] T2.6 Implement `POST /api/liff/readiness` actions
- [ ] T2.7 Build LIFF readiness checklist page
- [ ] T2.8 Track readiness analytics events

## Phase 3: Operations Summary

- [ ] T3.1 Define operations summary response contract
- [ ] T3.2 Implement operations aggregation service
- [ ] T3.3 Add `/ops` command handler
- [ ] T3.4 Implement `GET /api/liff/operations`
- [ ] T3.5 Build LIFF operations page
- [ ] T3.6 Add freshness and degraded-state indicators

## Phase 4: Daily Briefings

- [ ] T4.1 Define trip phase model for countdown, departure, active, and return
- [ ] T4.2 Implement deterministic daily briefing composer
- [ ] T4.3 Add optional LLM summarization layer
- [ ] T4.4 Add `/brief` command handler
- [ ] T4.5 Add `POST /api/cron/daily-briefings`
- [ ] T4.6 Persist briefing send history
- [ ] T4.7 Add Google Weather enrichment with cache-backed fallback behavior

## Phase 5: Flight Monitoring and Alerts

- [ ] T5.1 Define supported flight reference format
- [ ] T5.2 Implement monitor creation and storage
- [ ] T5.3 Implement provider adapter and normalization
- [ ] T5.4 Implement alert diffing and dedupe
- [ ] T5.5 Add `POST /api/cron/transport-monitor`
- [ ] T5.6 Send LINE alerts and store alert history
- [ ] T5.7 Surface transport status inside operations view
- [ ] T5.8 Add route timing enrichment to operations summaries and briefings
- [ ] T5.9 Keep transport status provider abstraction independent from Google Maps Platform

## Phase 6: Incident Playbooks

- [ ] T6.1 Define initial incident taxonomy
- [ ] T6.2 Implement incident create/update service
- [ ] T6.3 Add `/incident [type]` command handler
- [ ] T6.4 Implement `POST /api/liff/incidents`
- [ ] T6.5 Build starter playbooks for delay, missed meetup, and lost document
- [ ] T6.6 Create follow-up tasks or readiness items from incident actions
- [ ] T6.7 Add incident analytics and audit logging

## Phase 7: Hardening

- [ ] T7.1 Add unit tests for readiness generation
- [ ] T7.2 Add unit tests for alert dedupe logic
- [ ] T7.3 Add integration tests for `/ops`, `/ready`, and `/brief`
- [ ] T7.4 Add operational dashboards and logs
- [ ] T7.5 Run beta with a small set of active trips
- [ ] T7.6 Add Google API timeout, retry, and degraded-state tests

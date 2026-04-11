# TravelSync AI v1.2 Implementation Plan

## Objective

Ship the first execution-stage version of TravelSync AI by layering operations, readiness, daily briefings, transport alerts, and incident playbooks on top of the existing planning platform.

## Principles

- Keep v1.1 planning flows stable while building v1.2 in parallel
- Materialize operational state in storage so chat and LIFF can stay fast
- Deliver incrementally from lowest-risk/highest-value features first
- Prefer deterministic fallbacks over LLM-only behavior for critical flows

## Workstreams

### 1. Data and Domain Foundations

- Add operational tables for readiness, monitors, alerts, incidents, and briefings
- Add domain service boundaries under `services/`
- Define typed API contracts for operations and readiness responses

### 2. Readiness MVP

- Build readiness generation heuristics from trip, board, and memory data
- Add organizer/member completion flows
- Add `/ready` summary and LIFF readiness page

### 3. Operations MVP

- Build live operations summary aggregator
- Add `/ops` summary command
- Add LIFF operations page

### 4. Daily Briefings

- Build deterministic daily summary composer
- Add optional LLM enhancement layer
- Add cron job and manual `/brief` trigger

### 5. Monitoring and Alerts

- Model monitored flight references
- Add polling and normalized status comparison
- Add alert persistence, dedupe, and LINE notifications

### 6. Incident Playbooks

- Define supported incident taxonomy
- Build starter playbooks and context attachment
- Add follow-up task generation and status transitions

## Recommended Build Order

1. Schema + service scaffolding
2. Readiness generation and LIFF checklist
3. Operations summary and `/ops`
4. Daily briefings and cron delivery
5. Flight monitoring and alerts
6. Incident playbooks

## Definition of Done for v1.2 MVP

- Organizer can open operations and readiness views in LIFF
- `/ops`, `/ready`, and `/brief` work end-to-end
- The system can generate and store readiness items
- The system can generate a daily briefing from current trip state
- At least one monitored transport type can trigger deduplicated alerts
- At least three incident types have functional guided flows
- Existing planning, voting, and expenses still work

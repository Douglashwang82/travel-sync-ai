# PRD: TravelSync AI

> **Version:** 1.2 | **Date:** 2026-04-10 | **Status:** Draft

---

## 1. Context

### Problem Statement
TravelSync AI already helps groups turn messy LINE conversations into reusable trip knowledge, explicit decisions, and shared board state. The next major gap appears after decisions are made: the highest-risk parts of travel happen during pre-departure preparation, departure day, in-trip execution, and return. At those stages, groups are no longer blocked by "what should we do?" but by "what must happen now, who is responsible, and what changed?"

Critical operational details such as passport readiness, visa deadlines, check-in windows, airport meeting points, live transport changes, day-of reservations, and contingency steps are easy to lose in chat. The organizer again becomes the human backup system, manually tracking readiness, chasing confirmations, and coordinating when plans break.

### Product Vision
A world where TravelSync AI is not only the group trip planning memory and decision copilot inside LINE, but also the execution copilot that keeps the group prepared, synchronized, and resilient from countdown to return.

### Goals
- Reduce organizer coordination effort during pre-departure and in-trip execution by 60%
- Help groups complete critical readiness tasks before departure with 80% checklist completion on active trips
- Deliver daily operational summaries that achieve 50%+ open or interaction rate during active trips
- Validate that TravelSync AI can support high-risk travel stages without requiring a separate app
- Create the foundation for premium operational features such as monitoring, concierge-like support, and affiliate post-booking workflows

### Non-Goals
- **Not a booking engine.** We still do not process payments or reservations directly.
- **Not a full travel agency operations platform.** v1.2 supports consumer group execution, not professional tour operations.
- **Not a general-purpose emergency service.** We provide guidance, reminders, and contact surfacing, not guaranteed live human intervention.
- **No standalone mobile app.** LINE and LIFF remain the primary experience.
- **No full OCR or document image ingestion in v1.2.** Document status is structured manually or through lightweight link/reference capture.
- **No real-time airline-grade guarantees.** Alerts should be helpful and resilient, but availability depends on external providers.

---

## 2. User Experience

### Persona 1: Mei-Ling, The Overwhelmed Organizer
- **Background:** 27-year-old marketing coordinator who usually organizes trips for a LINE group of 6 to 10 friends.
- **Pain Point:** Even after the group chooses hotels and activities, she still has to remember who has their passport ready, who has checked in, what time everyone needs to leave, and what to do if something changes.
- **Motivation:** Wants TravelSync AI to become the group's shared trip operations brain so she does not have to manually orchestrate every high-risk step.

### Persona 2: Jason, The Passive Participant
- **Background:** 24-year-old software engineer who prefers low-friction travel coordination.
- **Pain Point:** He does not know what is urgent, what he personally still owes the group, or where to find the latest meeting point and timing.
- **Motivation:** Wants clear personal prompts like "confirm passport", "check in now", or "meet at Terminal 1 at 7:10 AM" without reading the entire backlog.

### Persona 3: Kai, The Power Planner
- **Background:** 30-year-old freelance designer who values structure and clarity.
- **Pain Point:** The current planning board helps with choices, but once the trip gets close, operational items, documents, live changes, and contingencies need stronger structure than a generic board.
- **Motivation:** Wants a command center that separates planning from execution and makes responsibilities, timing, and exceptions visible.

### Critical User Flow

**Flow Name:** "Confirmed trip becomes an operationally guided journey"

```text
Step 1: Group confirms key choices during planning
        -> TravelSync AI already has trip knowledge, board state, and confirmed items

Step 2: As departure approaches, the organizer opens the readiness view
        -> AI generates a pre-departure checklist for passports, visas, check-in, bookings, and reminders

Step 3: Members confirm readiness and missing items
        -> AI tracks completion, nudges lagging members, and surfaces risk areas

Step 4: On departure day and during the trip, AI sends daily briefings and operational reminders
        -> Group sees today's plan, reservations, transport windows, and action owners

Step 5: A disruption happens (delay, missed meetup, illness, closure, weather issue)
        -> AI switches into incident support mode with next steps, key contacts, and fallback actions

Step 6: The trip returns and closes cleanly
        -> AI helps with checkout, exit reminders, final confirmations, and return-home wrap-up
```

**Why this flow is the core:** Planning quality matters, but user trust compounds when the product is most useful at the highest-risk moments. v1.2 expands TravelSync AI from planning copilot to execution copilot.

**High-risk drop-off points:**
- **Step 2 -> Step 3:** If readiness tracking is too manual or incomplete, organizers will revert to ad hoc chat chasing.
- **Step 3 -> Step 4:** If daily summaries are noisy or inaccurate, users will ignore them.
- **Step 4 -> Step 5:** If incident handling is vague, the product will fail in the moments when trust matters most.

### User Stories

| # | As a... | I want to... | So that... | Priority |
|---|---------|--------------|------------|----------|
| 1 | Group organizer | Open an operations view showing what is happening next | I can manage the live trip without piecing details together from chat | P0 |
| 2 | Group organizer | Track pre-departure readiness for documents, check-in, and confirmations | I can spot missing or risky items before departure | P0 |
| 3 | Group member | See my own urgent tasks and confirmations | I know exactly what I still need to do | P0 |
| 4 | Group member | Receive a daily briefing in chat during active travel | I can follow the plan without searching for updates | P0 |
| 5 | Group organizer | Get alerted when flights or transport plans change | The group can react before small issues become major disruptions | P0 |
| 6 | Group member | Use guided incident flows for common travel problems | The group gets structured help when plans go wrong | P0 |
| 7 | Group organizer | See assigned responsibilities and due times for operational tasks | Accountability is visible instead of implied | P1 |
| 8 | Group member | Confirm statuses like checked in, on the way, or arrived | The group can coordinate quickly on departure and return days | P1 |
| 9 | Group organizer | Track document references and status per traveler | I can verify readiness without repeatedly asking the group | P1 |
| 10 | Group organizer | Finish the trip with clean return reminders and wrap-up tasks | The group does not miss checkout, customs, or financial loose ends | P1 |

---

## 3. Requirements

### 3.1 Functional Requirements (P0 - v1.2)

#### Feature 1: Trip Operations Command Center
- **Description:** A dedicated operational layer in LIFF and chat that surfaces the live state of the trip, including what is next, today's timeline, active risks, required confirmations, and critical links.
- **Functional Requirements:**
  - FR-01: Provide an operations view that summarizes trip phase, next actions, active risks, and key logistics
  - FR-02: Show upcoming confirmed items, departure milestones, and time-sensitive reminders in one place
  - FR-03: Distinguish planning-only information from execution-critical information
  - FR-04: Support organizer visibility into unresolved readiness gaps and missing member confirmations
  - FR-05: Make the operations view accessible from LIFF and discoverable from chat commands
- **Constraints & NFRs:** The operations summary should load in under 2 seconds in LIFF and return a concise chat summary in under 3 seconds.
- **Acceptance Criteria:**
  - [ ] The organizer can open a single screen and see what is happening today, what is next, and what is risky
  - [ ] Members can see trip-critical details without browsing the full board
  - [ ] Confirmed trip information is prioritized over speculative or planning-only items

#### Feature 2: Pre-Departure Readiness Checklist
- **Description:** A structured readiness system that turns confirmed trip data into checklist items such as passport validity, visa completion, check-in windows, booking confirmation, payment deadlines, and packing reminders.
- **Functional Requirements:**
  - FR-06: Generate readiness checklist items from trip context, confirmed decisions, and detected constraints
  - FR-07: Support checklist categories such as documents, reservations, transport, money, packing, and meetup readiness
  - FR-08: Track readiness status at the trip level and optionally per member
  - FR-09: Send nudges for overdue or unresolved readiness items
  - FR-10: Allow organizers to manually add, edit, resolve, or dismiss readiness items
- **Constraints & NFRs:** The checklist must be usable even when not all trip data is complete. Incomplete data should produce explicit "unknown" states rather than silent omission.
- **Acceptance Criteria:**
  - [ ] A trip close to departure shows a structured readiness checklist instead of only generic board items
  - [ ] The bot can highlight missing document or booking confirmations
  - [ ] Members and organizers can mark readiness items complete through LIFF or chat flows

#### Feature 3: Flight and Transport Change Alerts
- **Description:** A monitoring and alerting layer for flight and transport changes that informs the group when departure-critical logistics have shifted.
- **Functional Requirements:**
  - FR-11: Allow the trip to store monitored transport references such as flight numbers and other itinerary-critical transport items
  - FR-12: Periodically check external transport status where supported
  - FR-13: Detect meaningful changes such as delays, cancellations, gate changes, or time changes
  - FR-14: Post a concise alert in chat and update the operations view when a critical change is detected
  - FR-15: Avoid duplicate or excessively noisy alerts for the same incident
- **Constraints & NFRs:** Monitoring should degrade gracefully when providers are unavailable. The system must record the last known check result and alert reason.
- **Acceptance Criteria:**
  - [ ] A detected delay triggers a chat notification with the changed status and next suggested action
  - [ ] Repeated checks do not spam the group with identical alerts
  - [ ] The operations view shows the latest known transport status

#### Feature 4: Daily Briefing and Run-of-Day Assistant
- **Description:** A daily execution summary that gives the group a concise operational briefing based on itinerary, confirmed items, transport windows, weather context, deadlines, and open risks.
- **Functional Requirements:**
  - FR-16: Generate a daily briefing for departure day, active trip days, and return day
  - FR-17: Include the day's confirmed schedule, logistics windows, urgent tasks, and unresolved risks
  - FR-18: Support a short chat version and a richer LIFF version
  - FR-19: Let organizers trigger or resend the briefing manually
  - FR-20: Personalize member-specific action prompts when appropriate without fragmenting the shared group summary
- **Constraints & NFRs:** The briefing must be concise enough for chat and should not overwhelm users with low-priority information.
- **Acceptance Criteria:**
  - [ ] The group receives a useful morning summary during the active trip
  - [ ] The summary highlights what needs action today, not just a raw itinerary dump
  - [ ] Organizers can manually request the latest run-of-day summary

#### Feature 5: Incident and Exception Playbooks
- **Description:** Guided response flows for common travel disruptions such as missed meetups, flight delays, lost documents, illness, venue closure, weather disruption, or late arrival.
- **Functional Requirements:**
  - FR-21: Support structured incident types with recommended next steps and checklist actions
  - FR-22: Surface relevant context such as current day plan, key bookings, and emergency or support contacts when an incident is triggered
  - FR-23: Allow organizers or members to mark an incident as active, resolved, or escalated
  - FR-24: Create follow-up actions on the board or readiness system when incident mitigation requires concrete work
  - FR-25: Preserve an audit trail of incident events and system guidance
- **Constraints & NFRs:** The system must clearly indicate that recommendations are guidance, not guaranteed real-time human support. Flows must remain useful even with partial data.
- **Acceptance Criteria:**
  - [ ] A missed-flight or delay incident can be opened and produces a structured response flow
  - [ ] Incident guidance includes next steps rather than a generic apology
  - [ ] Follow-up tasks created from incidents are visible to the organizer

#### Feature 6: Operational Commands
- **Description:** New commands extend the current command set so users can access readiness, daily operations, and incidents without leaving LINE.
- **Functional Requirements:**
  - FR-26: Support `/ops` to summarize live operational state
  - FR-27: Support `/ready` to view readiness progress and unresolved items
  - FR-28: Support `/brief` to request the daily briefing on demand
  - FR-29: Support `/incident [type]` to start a guided incident flow
  - FR-30: Keep the existing planning commands intact and compatible with the operations layer
- **Constraints & NFRs:** Commands should acknowledge quickly and send follow-up messages when background work is needed.
- **Acceptance Criteria:**
  - [ ] `/ops` returns a concise operations snapshot
  - [ ] `/ready` highlights missing or overdue items
  - [ ] `/incident delay` or similar starts a structured assistance flow

### 3.2 Edge Cases & Error Handling

| Scenario | Expected Behavior |
|----------|-------------------|
| A trip has confirmed items but incomplete departure details | Show partial readiness with explicit unknowns instead of pretending all is well |
| A transport provider is temporarily unavailable | Keep the last known status, show monitoring as degraded, and avoid false certainty |
| A daily briefing has no meaningful updates | Send a short summary with only today's essentials instead of noisy filler |
| Multiple incidents are triggered at once | Keep incidents separate, surface priority, and avoid overwriting prior state |
| A member never confirms readiness | Mark the item as unresolved and keep organizer visibility without blocking the entire trip model |
| The trip has no flight data but departure day exists | Provide readiness and timing guidance without transport monitoring |
| The AI generates a weak or irrelevant operational suggestion | Let organizers ignore or dismiss it without damaging confirmed trip state |
| A delay alert arrives after the issue is already resolved | Record it, suppress duplicate noise where possible, and surface the latest status as authoritative |
| A user opens LIFF with an invalid or spoofed identity | Deny access and expose no trip data |
| Incident support lacks enough context | Return the safest available generic playbook and ask for the minimum missing detail |

### 3.3 Analytics & Telemetry Requirements

| Event Name | Trigger | Properties | Purpose |
|------------|---------|------------|---------|
| `ops_view_opened` | User opens operations view | `group_id`, `trip_id`, `user_id`, `source` | Measure operations engagement |
| `readiness_item_generated` | System creates checklist item | `group_id`, `trip_id`, `category`, `source` | Measure readiness coverage |
| `readiness_item_completed` | Item marked done | `group_id`, `trip_id`, `category`, `completed_by` | Track completion behavior |
| `readiness_nudge_sent` | System nudges unresolved item | `group_id`, `trip_id`, `category`, `days_to_departure` | Monitor reminder usefulness |
| `daily_briefing_sent` | Briefing delivered | `group_id`, `trip_id`, `trip_phase`, `item_count` | Track briefing usage |
| `transport_monitor_checked` | Monitoring job runs | `group_id`, `trip_id`, `provider`, `result` | Observe provider health |
| `transport_alert_sent` | Critical change announced | `group_id`, `trip_id`, `alert_type`, `severity` | Measure operational impact |
| `incident_started` | Incident flow opened | `group_id`, `trip_id`, `incident_type`, `trigger_source` | Understand disruption patterns |
| `incident_resolved` | Incident closed | `group_id`, `trip_id`, `incident_type`, `time_to_resolution_minutes` | Measure resolution quality |
| `ops_command_used` | `/ops`, `/ready`, `/brief`, or `/incident` used | `group_id`, `trip_id`, `command` | Track command adoption |

### 3.4 Post-v1.2 Features (P1/P2)
- **Traveler confirmation workflow:** checked in, on the way, arrived, boarded, landed - P1
- **Document vault with per-member verification state:** passport, visa, insurance, booking references - P1
- **Assignee and responsibility model:** explicit task ownership and escalation - P1
- **Knowledge correction UI for operational facts:** fix timings, references, and readiness data - P1
- **Post-trip wrap-up hub:** return-home checklist, expense closure, support follow-ups - P1
- **Premium incident escalation and concierge handoff:** human-assisted or partner-assisted flows - P2
- **Broader transport monitoring coverage:** rail, ferry, bus, and airport transfer providers - P2
- **More localized compliance guidance:** country-specific visa and entry requirements - P2

---

## 4. Constraints

### Performance
| Requirement | Target |
|-------------|--------|
| LINE webhook response time | < 1 second |
| `/ops` and `/ready` acknowledgment | < 2 seconds |
| Daily briefing generation | < 5 seconds for initial response |
| LIFF operations page load | < 2 seconds on 4G |
| Readiness checklist query | < 2 seconds |
| Incident playbook response | < 3 seconds for first guidance |

### Security & Privacy
- Operational data must remain scoped to verified group membership
- Document and readiness data must expose the minimum needed information to the group
- Alerts and incident logs must avoid leaking sensitive traveler details into unauthorized contexts
- External monitoring integrations must be server-side and use managed secrets

### Delivery Constraints
- v1.2 should extend the existing monolithic Next.js + Supabase architecture
- New features must degrade gracefully when external monitoring providers are unavailable
- The planning workflow from v1.1 must continue to work without requiring operational setup
- New execution-stage features should be shippable incrementally, not as a single all-or-nothing launch

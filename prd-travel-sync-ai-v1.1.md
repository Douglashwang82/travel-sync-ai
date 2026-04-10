# PRD: TravelSync AI

> **Version:** 1.1 | **Date:** 2026-04-10 | **Status:** Draft

---

## 1. Context

### Problem Statement
Group travel planning is plagued by fragmented communication, decision paralysis, and unclear accountability. Critical information such as flight details, hotel ideas, restaurant links, constraints, and preferences gets buried in hundreds of chat messages, making it difficult to retrieve when the group actually needs it. The organizer carries too much mental load: remembering what was already shared, turning loose discussion into concrete next steps, and knowing when something needs a vote versus when it should simply remain shared knowledge.

### Product Vision
A world where planning a group trip is as effortless as chatting with friends, with an AI copilot embedded directly in LINE that continuously builds trip knowledge from conversation, keeps the group aligned, recommends from what the group already knows, and only introduces voting when a real decision must be made.

### Goals
- Reduce group travel planning communication time by 70% compared to unassisted LINE group chats
- Achieve 60% user activation rate (complete first trip planning flow) within the first week of adding the bot
- Validate product-market fit with 500+ active groups during closed beta (Q3 2026)
- Establish first OTA affiliate revenue stream by Q4 2026
- Prove that knowledge-first planning improves retrieval and recommendation quality before a vote is needed

### Non-Goals
- **Not a standalone travel app.** All interactions happen within LINE and LIFF.
- **Not a booking engine.** We link out to OTA partners but do not process reservations or payments directly in MVP.
- **No WhatsApp or other messaging platform support in v1.** LINE-only focus remains intentional.
- **No enterprise or B2B workflow in v1.** The primary audience is consumer friend-group travel.
- **No offline mode.** Internet access is required.
- **No automatic voting on every suggestion.** Shared knowledge should not be forced into a poll by default.

---

## 2. User Experience

### Persona 1: Mei-Ling, The Overwhelmed Organizer
- **Background:** 27-year-old marketing coordinator who usually ends up organizing trips for a LINE group of 6 to 10 friends.
- **Pain Point:** She remembers that people shared useful things in chat, but not where or when. By the time the group is ready to choose, she has to scroll endlessly or ask everyone to resend links.
- **Motivation:** Wants the bot to quietly remember what the group has discussed, surface the best knowledge when needed, and only create a formal vote when the group is truly ready to decide.

### Persona 2: Jason, The Passive Participant
- **Background:** 24-year-old software engineer who rarely initiates planning and often replies with "anything is fine."
- **Pain Point:** He does not want to read the entire backlog just to know which restaurants or hotels were already mentioned.
- **Motivation:** Wants quick recommendations and one-tap votes only when a concrete decision is on the table.

### Persona 3: Kai, The Power Planner
- **Background:** 30-year-old freelance designer who values structure and clarity.
- **Pain Point:** He gets frustrated when planning items, shared ideas, and final decisions are all mixed together.
- **Motivation:** Wants a system that distinguishes between planning context, remembered knowledge, and active decisions.

### Critical User Flow

**Flow Name:** "Group chat becomes reusable knowledge, then an explicit decision"

```text
Step 1: Organizer adds TravelSync AI bot to LINE group
        -> Bot sends welcome message and starts tracking trip context

Step 2: Group members chat naturally and share links ("this hotel looks good", "let's eat here", "avoid Shibuya on Saturday")
        -> AI passively parses messages, stores structured trip knowledge, and creates planning items when action is needed

Step 3: Later, someone asks for suggestions ("what restaurants have we talked about?")
        -> Bot recommends from remembered group knowledge first

Step 4: Organizer decides the group is ready to choose
        -> Organizer creates a decision item, such as /decide restaurant

Step 5: Organizer starts voting
        -> Bot seeds the decision from remembered knowledge, adds fresh search results if needed, runs voting, and updates the board
```

**Why this flow is the core:** This is the real product promise. The system is not just a voting bot. It is a memory and planning copilot that turns messy chat into usable knowledge, then converts only the right moments into structured decisions.

**High-risk drop-off points:**
- **Step 1 -> Step 2:** If onboarding is unclear, users will not trust passive parsing.
- **Step 2 -> Step 3:** If the bot remembers too little or remembers irrelevant noise, recommendations will feel weak.
- **Step 4 -> Step 5:** If users do not understand the distinction between planning items and decision items, voting will feel confusing.

### User Stories

| # | As a... | I want to... | So that... | Priority |
|---|---------|--------------|------------|----------|
| 1 | Group organizer | Add the bot to my LINE group and set trip dates and destination | The AI can start building trip context immediately | P0 |
| 2 | Group member | Mention places naturally in chat or share a URL | The bot remembers useful travel knowledge without extra formatting | P0 |
| 3 | Group member | Ask what hotels, restaurants, or activities we have already discussed | I can retrieve group knowledge without scrolling through old chat | P0 |
| 4 | Group organizer | See planning items separately from active decisions | I can manage the trip without conflating ideas and votes | P0 |
| 5 | Group organizer | Create a decision item only when the group is ready to choose | Votes happen intentionally, not prematurely | P0 |
| 6 | Group member | Vote on options via visual cards once a decision item exists | I can participate quickly when an actual choice is needed | P0 |
| 7 | Group organizer | Have the AI recommend from remembered knowledge before searching externally | The group benefits from its own prior discussion first | P0 |
| 8 | Group member | View the trip board and itinerary in LIFF | I can understand current planning status at any time | P1 |
| 9 | Group organizer | Track expenses and view summaries in the same trip workspace | Financial coordination is easier after decisions are made | P1 |
| 10 | Group organizer | Export or share the final itinerary later | The confirmed plan is easy to distribute | P2 |

---

## 3. Requirements

### 3.1 Functional Requirements (P0 - MVP)

#### Feature 1: Semantic Chat Parsing Engine
- **Description:** Continuously monitors LINE group messages and extracts structured travel-relevant entities such as dates, locations, preferences, constraints, and place mentions using LLM-powered natural language understanding.
- **Functional Requirements:**
  - FR-01: Parse incoming LINE group messages in near real time and identify travel-relevant entities
  - FR-02: Maintain a per-group context window that helps resolve conversational references
  - FR-03: Detect and flag conflicting information
  - FR-04: Support Traditional Chinese as the primary language, with mixed Chinese-English handling
  - FR-05: Ignore irrelevant messages without producing noisy knowledge
- **Constraints & NFRs:** Message parsing latency must be under 3 seconds on average. LLM cost must remain bounded through relevance filtering and structured context.
- **Acceptance Criteria:**
  - [ ] Given a chat containing "我們7/15-7/20去大阪", the system extracts destination and dates correctly
  - [ ] Given interleaved stickers and off-topic messages, the system ignores irrelevant content
  - [ ] Given conflicting dates from different members, the system flags the conflict for follow-up

#### Feature 2: Trip Knowledge Memory
- **Description:** A durable knowledge layer that stores useful places and travel context derived from chat history and shared links. This memory is separate from voting and is the primary source for recommendations.
- **Functional Requirements:**
  - FR-06: Save remembered places and knowledge from natural chat and `/share [url]`
  - FR-07: Deduplicate repeated mentions of the same place within a trip
  - FR-08: Track metadata such as title, summary, address, rating, source link, and mention count when available
  - FR-09: Surface remembered knowledge back into parsing context and recommendations
  - FR-10: Do not automatically convert remembered knowledge into a vote or board decision item
- **Constraints & NFRs:** Knowledge retrieval should feel instant in chat responses. Stored memory should remain scoped to a trip.
- **Acceptance Criteria:**
  - [ ] If two members mention the same restaurant on different days, the bot stores one remembered entry with a higher mention count
  - [ ] If a member shares a booking or restaurant URL, the bot saves it as trip knowledge with extracted metadata
  - [ ] Remembered knowledge does not automatically create a vote

#### Feature 3: Three-Stage Board with Planning and Decision Separation
- **Description:** A persistent board that tracks trip items through To-Do, Pending, and Confirmed stages, while clearly distinguishing planning items from decision items.
- **Functional Requirements:**
  - FR-11: Allow creation of planning items for tasks and reminders
  - FR-12: Allow creation of explicit decision items that are eligible for voting
  - FR-13: Move only decision items into Pending when a vote starts
  - FR-14: Move confirmed decisions into Confirmed with winning option details attached
  - FR-15: Allow organizer edits and lifecycle management through commands and LIFF
  - FR-16: Display the board via LIFF with enough context to understand what is planning vs decision state
- **Constraints & NFRs:** Board state must persist across restarts and load in under 2 seconds in LIFF.
- **Acceptance Criteria:**
  - [ ] `/add Book travel insurance` creates a planning item
  - [ ] `/decide restaurant` creates a decision item
  - [ ] `/vote restaurant` only works when the matching item is a decision item

#### Feature 4: Knowledge-Driven Recommendation and Planning
- **Description:** The bot can recommend restaurants, hotels, activities, and other trip candidates using remembered group knowledge first, not just fresh external search.
- **Functional Requirements:**
  - FR-17: Support `/recommend [type]` to retrieve top remembered candidates from group knowledge
  - FR-18: Rank recommendations using mention count, recency, and available metadata
  - FR-19: Use remembered knowledge as the first source when seeding decision options
  - FR-20: Fall back to external search only when remembered knowledge is insufficient
  - FR-21: Allow future planning flows to reference but not be limited to remembered knowledge
- **Constraints & NFRs:** Recommendations should return quickly and feel grounded in the group's own discussion.
- **Acceptance Criteria:**
  - [ ] `/recommend restaurant` returns restaurants previously mentioned or shared in chat
  - [ ] If enough remembered options exist, a decision can be seeded without external search
  - [ ] If no remembered options exist, the bot responds gracefully and suggests how to add knowledge

#### Feature 5: Explicit Decision and Voting Workflow
- **Description:** Voting is available only for decision items and is used when the group is ready to make a choice.
- **Functional Requirements:**
  - FR-22: `/decide [item]` creates a decision item
  - FR-23: `/vote [item]` starts a vote only for a matching decision item
  - FR-24: Generate Flex Message vote cards with up to 5 options
  - FR-25: Allow one current vote per user per decision, with vote changes allowed until close
  - FR-26: Close voting when majority is reached or the deadline expires
  - FR-27: Persist vote results and announce the winner in chat
- **Constraints & NFRs:** Votes must be traceable, consistent, and membership-validated.
- **Acceptance Criteria:**
  - [ ] `/vote restaurant` on a planning-only item is rejected with guidance to use `/decide`
  - [ ] `/vote restaurant` on a decision item starts a vote and shows a carousel
  - [ ] When voting completes, the winning option is attached to the confirmed item

#### Feature 6: Organizer Bot Commands
- **Description:** Slash commands provide structured control while still allowing the product to work through natural conversation.
- **Functional Requirements:**
  - FR-28: `/start [destination] [dates]` initializes a trip
  - FR-29: `/add [item]` creates a planning item
  - FR-30: `/decide [item]` creates a decision item
  - FR-31: `/vote [item]` starts a vote for a decision item
  - FR-32: `/recommend [type]` retrieves remembered suggestions
  - FR-33: `/status`, `/nudge`, `/help`, `/share`, `/exp`, and `/exp-summary` remain available
- **Constraints & NFRs:** Commands should respond quickly and explain failures clearly.
- **Acceptance Criteria:**
  - [ ] `/help` reflects the knowledge-first workflow
  - [ ] `/share` confirms that something was saved as trip knowledge
  - [ ] Unrecognized commands return a friendly fallback

#### Feature 7: LINE Bot, LIFF, and Expense Infrastructure
- **Description:** The bot, LIFF dashboard, itinerary, and expense features remain part of the same trip workspace.
- **Functional Requirements:**
  - FR-34: Receive and process LINE webhook events securely
  - FR-35: Authenticate LIFF users with verified LINE identity and trip membership
  - FR-36: Serve LIFF pages for dashboard, itinerary, votes, help, and expenses
  - FR-37: Support expense capture and settlement summary for active trips
  - FR-38: Handle multi-group support safely
- **Constraints & NFRs:** Webhook acknowledgment and LIFF membership checks remain mandatory.
- **Acceptance Criteria:**
  - [ ] LIFF pages only expose data for verified group members
  - [ ] Users can open the board, itinerary, and expenses in LIFF without separate sign-up
  - [ ] Expense reads and writes are tied to authenticated trip membership

### 3.2 Edge Cases & Error Handling

| Scenario | Expected Behavior |
|----------|-------------------|
| Bot is added to a group with a large pre-existing conversation | Bot starts fresh and does not backfill old messages by default |
| Members repeatedly mention the same restaurant in different ways | The bot deduplicates into one remembered knowledge entry when it can |
| A user asks for recommendations before any places were shared | The bot says there is no remembered knowledge yet and suggests chatting naturally or using `/share` |
| A user runs `/vote restaurant` without a decision item | The bot refuses the vote and asks the user to create a decision item first |
| A decision item has no remembered options and external search fails | The item stays in To-Do and the bot asks the group to share ideas or links |
| AI misparses a message into knowledge | Organizer can still steer the board manually; future UI correction can be added without changing the core model |
| Invalid or spoofed LIFF identity is used against a protected API | The API returns an authorization error and no trip data is exposed |
| Vote is tied after deadline | Extend the vote and notify the group or organizer |
| LIFF page fails to load | Show retry state and keep chat commands as fallback |
| LLM or place search is unavailable | Degrade gracefully, preserve current state, and retry where appropriate |

### 3.3 Analytics & Telemetry Requirements

| Event Name | Trigger | Properties | Purpose |
|------------|---------|------------|---------|
| `bot_added_to_group` | Bot joins a LINE group | `group_id`, `member_count`, `inviter_user_id` | Track adoption |
| `trip_created` | Organizer runs `/start` | `group_id`, `destination`, `trip_duration_days`, `member_count` | Measure activation |
| `message_parsed` | AI extracts relevant entity or action | `group_id`, `entity_type`, `confidence_score` | Monitor parsing quality |
| `knowledge_saved` | Place or travel knowledge is remembered | `group_id`, `trip_id`, `item_type`, `source` | Measure memory usefulness |
| `recommendation_requested` | User runs `/recommend` | `group_id`, `trip_id`, `item_type`, `result_count` | Measure memory retrieval demand |
| `decision_item_created` | User runs `/decide` | `group_id`, `trip_id`, `item_type` | Measure explicit decision intent |
| `vote_initiated` | Vote carousel is sent | `group_id`, `item_type`, `options_count`, `seed_source` | Track decisions and option sourcing |
| `vote_cast` | Member casts a vote | `group_id`, `user_id`, `item_id`, `time_since_vote_initiated` | Measure engagement |
| `vote_completed` | Decision is finalized | `group_id`, `item_id`, `participation_rate`, `time_to_decision_hours` | Core decision metric |
| `liff_opened` | User opens a LIFF page | `group_id`, `user_id`, `page`, `source` | Track LIFF engagement |

### 3.4 Post-MVP Features (P1/P2)
- **Visual itinerary timeline:** richer itinerary experience in LIFF - P1
- **Knowledge editing and correction UI:** allow users to inspect and fix remembered trip knowledge - P1
- **AI planning suggestions:** synthesize plans using knowledge, constraints, and external data - P1
- **OTA affiliate integration:** attach booking links with attribution - P1
- **Itinerary export:** PDF or calendar sync - P1
- **Smart bill splitting and payment assistance:** improve current expense workflow - P2
- **Flight monitoring:** track flight changes and alert the group - P2
- **Multi-language UI:** English and Japanese support - P2

---

## 4. Constraints

### Performance
| Requirement | Target |
|-------------|--------|
| LINE webhook response time | < 1 second |
| Bot command response time | < 2 seconds for immediate acknowledgment |
| Chat message parsing latency | < 3 seconds average |
| LIFF dashboard load time | < 2 seconds on 4G |
| Recommendation response time | < 2 seconds for remembered knowledge retrieval |
| Concurrent active groups | Support 1,000 simultaneously active groups in MVP |

### Security
| Requirement | Details |
|-------------|---------|
| Authentication | LINE Login via LIFF SDK, no custom passwords |
| API security | Verified LINE user identity and trip membership for protected LIFF APIs |
| Data encryption | AES-256 at rest and TLS in transit |
| Rate limiting | Group and user command limits remain in place |
| Secrets management | All credentials stored outside code |

### Privacy & Compliance
- **Applicable regulations:** Taiwan PDPA first, with future regional expansion considerations
- **PII handling:** LINE user IDs are pseudonymous; display names may be cached for UX only
- **Data retention:** Trip data retained after trip completion for a limited period; raw messages kept briefly
- **Consent:** Users must be informed that parsing is active and may opt out where supported
- **Data residency:** Favor Taiwan or nearby Asia region infrastructure

### Localization & Accessibility
- **Languages:** zh-TW first, mixed Chinese-English support
- **Accessibility:** LIFF pages should maintain readable sizes and touch-friendly controls

---

## 5. Technical Implementation (Reference)

> **Note:** This section is a reference for engineering, not a mandate.

### Recommended Tech Stack

| Layer | Technology | Rationale |
|-------|------------|-----------|
| Frontend (LIFF) | Next.js + Tailwind CSS | One stack for app pages and APIs |
| Backend / API | Next.js route handlers + Node.js | Unified delivery and fast iteration |
| LLM Integration | Structured-output LLM | Reliable entity and action extraction |
| Database | Supabase (PostgreSQL) | Strong relational model for trips, items, votes, and knowledge |
| Hosting | Vercel | Fast deployment and cron support |
| Messaging SDK | LINE Messaging API + LIFF SDK | Core platform integration |

### System Architecture Overview
The system operates as a Next.js application with a durable event log, a parsing pipeline, a trip knowledge memory layer, a trip-item board, and a separate decision/vote engine. The webhook path acknowledges quickly, while background processing handles parsing and memory updates. Knowledge is stored independently from votes. Decision items pull from remembered knowledge first, then fall back to external place search if needed.

### API & Third-Party Integrations
| Integration | Purpose | Notes |
|-------------|---------|-------|
| LINE Messaging API | Chat, Flex Messages, rich menus | Core messaging surface |
| LINE LIFF SDK | Embedded web app and identity | Required for in-LINE UI |
| LLM provider | Semantic parsing and structured extraction | Use strict schema validation |
| Google Places API | External place fallback and enrichment | Used only when knowledge is insufficient |
| Supabase | Database and auth helpers | System of record |

### Key Technical Decisions & Trade-offs
- **Knowledge first, votes second:** The product stores knowledge independently and only creates votes through explicit decision items. Trade-off: slightly more complexity in the domain model, but much clearer user behavior.
- **Trip memory separate from trip items:** Shared places should not clutter the board unless they become planning work or a decision. Trade-off: more tables and retrieval logic, but much better long-term product clarity.
- **Decision seeding from memory before search:** The system should prefer what the group already discussed. Trade-off: recommendations may be narrower, but they are more relevant and trusted.
- **Single app over microservices:** Faster to ship and maintain for a small team.

---

## 6. Strategy & Success

### Strategic Assumptions

| # | Assumption | How to Test | Invalidation Signal |
|---|-----------|-------------|---------------------|
| 1 | Groups want the bot to remember useful travel knowledge automatically | Observe repeated use of `/share` and recommendation requests | Users ignore retrieval and continue manually resending links |
| 2 | Separating planning items from decision items reduces confusion | Compare support friction and task completion before and after rollout | Users frequently misuse `/vote` or fail to understand `/decide` |
| 3 | Recommendations grounded in group knowledge feel more valuable than generic search | Measure engagement with `/recommend` and decision completion speed | Recommendations are rarely used or are perceived as low quality |
| 4 | Users will tolerate passive parsing if it clearly improves coordination | Track retention, opt-out rate, and bot removal | High opt-out or removal rate |
| 5 | Explicit decisions improve vote quality and reduce poll fatigue | Track vote participation and number of unnecessary polls | Many votes start with low participation or immediate cancellation |

### Pivot Triggers
If users do not use knowledge retrieval and recommendation features, and behavior remains almost entirely command-and-vote driven, then the memory-first product angle may not be compelling enough. If users remain confused by the distinction between planning and decision items after onboarding improvements, we should revisit the interaction model and possibly simplify it further.

### Success Metrics

| Metric | Target | Measurement Method |
|--------|--------|-------------------|
| Group activation rate | > 60% within 48 hours | `bot_added_to_group` -> `trip_created` |
| Recommendation usage rate | > 30% of active groups request recommendations | `recommendation_requested` |
| Knowledge reuse rate | > 40% of decision options come from remembered knowledge | `vote_initiated.seed_source` |
| Vote participation rate | > 50% of group members per decision | `vote_cast` events / member count |
| Time to decision | < 12 hours median | `vote_completed` |
| Parsing precision | > 85% | Manual review sample |
| Bot removal rate | < 25% within first trip cycle | `bot_removed` / `bot_added_to_group` |

### Rollout Plan

| Phase | Audience | Goal | Duration |
|-------|----------|------|----------|
| Alpha | Internal team + friendly groups | Validate knowledge capture, retrieval, and explicit decision workflow | 2 weeks |
| Closed Beta | 50 recruited groups | Tune parsing, memory quality, and recommendation usefulness | 6 weeks |
| Open Beta | Public LINE OA | Scale the memory-first workflow and validate retention | 8 weeks |
| GA Launch | General availability | Expand adoption and monetize adjacent trip flows | Ongoing |

---

*End of PRD - TravelSync AI v1.1*

# PRD: TravelSync AI

> **Version:** 1.0 | **Date:** 2026-04-03 | **Status:** Draft

---

## 1. Context

### Problem Statement
Group travel planning is plagued by fragmented communication, decision paralysis, and unclear accountability. Critical information — flight details, hotel bookings, restaurant preferences — gets buried in hundreds of chat messages, making it nearly impossible to retrieve. The "organizer" (主揪) bears an enormous mental load: chasing responses, consolidating preferences, and making bookings, often discovering at the last minute that key tasks were never completed.

### Product Vision
A world where planning a group trip is as effortless as chatting with friends — where an AI co-pilot embedded directly in LINE eliminates communication friction, drives decisions forward, and transforms the stressful logistics of group travel into an enjoyable social experience.

### Goals
- Reduce group travel planning communication time by 70% compared to unassisted LINE group chats
- Achieve 60% user activation rate (complete first trip planning flow) within the first week of adding the bot
- Validate product-market fit with 500+ active groups during closed beta (Q3 2026)
- Establish first OTA affiliate revenue stream by Q4 2026

### Non-Goals
> Non-goals are as important as goals. Without them, every meeting becomes a negotiation about scope. Be explicit and specific.

- **Not a standalone travel app.** We will not build a separate downloadable application. All interactions happen within LINE. If users must leave LINE, we've failed.
- **Not a booking engine.** We aggregate and link to OTA partners (Booking.com, Klook, KKday) but do not process reservations or payments directly in MVP.
- **No WhatsApp or other messaging platform support in v1.** LINE-only focus ensures we ship fast and deeply integrate with LINE-specific features (Flex Messages, LIFF).
- **No enterprise or B2B features.** We are not targeting travel agencies, corporate travel, or compliance-heavy organizations at this stage.
- **No offline mode.** All features require an active internet connection.
- **No solo-traveler optimization.** The product is purpose-built for group coordination (3+ people). Solo trip planning tools are out of scope.

---

## 2. User Experience

### Persona 1: Mei-Ling, The Overwhelmed Organizer (主揪)
- **Background:** 27-year-old marketing coordinator who loves travel and ends up planning most friend-group trips. Manages a LINE group of 6–10 friends.
- **Pain Point:** Spends 10+ hours over 2–3 weeks herding responses, comparing options, and tracking who has booked what. Frequently discovers missing bookings days before departure.
- **Motivation:** Wants to enjoy the excitement of trip planning without the administrative burden. Dreams of a system that tracks progress, nudges friends, and keeps everything organized automatically.

### Persona 2: Jason, The Passive Participant
- **Background:** 24-year-old software engineer who joins group trips but rarely initiates planning. Defaults to "anything is fine" (都可以) in group chats.
- **Pain Point:** Genuinely doesn't have strong preferences but feels guilty about not contributing. When forced to choose from walls of text, feels overwhelmed and disengages further.
- **Motivation:** Wants a frictionless way to participate — quick visual comparisons and one-tap voting rather than reading 200 messages to form an opinion.

### Persona 3: Kai, The Digital Nomad
- **Background:** 30-year-old freelance designer who travels frequently with different groups of friends and co-working communities. Highly organized but frustrated by others' chaos.
- **Pain Point:** Repeats the same organizational patterns across multiple trip groups. Needs structured task tracking and real-time status visibility across concurrent trips.
- **Motivation:** Wants a power-user tool that manages multiple trip groups simultaneously with professional-grade status tracking and automated reminders.

### Critical User Flow

**Flow Name:** "Organizer adds bot to group → First trip decision is made"

```
Step 1: Organizer adds TravelSync AI bot to LINE group
        → Bot sends welcome message with quick-start guide and asks for trip dates/destination

Step 2: Group members chat naturally about preferences ("I want sushi", "Let's avoid Shibuya on Saturday")
        → AI passively parses messages, extracts dates/locations/preferences, populates the To-Do board

Step 3: Organizer (or AI) triggers a hotel decision
        → Bot generates Flex Message cards with 3 options (photo, price, rating, distance) and inline vote buttons

Step 4: Members tap to vote on preferred hotel
        → Bot shows real-time vote tally, gently nudges non-voters after 4 hours

Step 5: Voting closes (majority reached or deadline hit)
        → Bot confirms decision, moves item to "Confirmed" status, extracts booking link, and updates the LIFF dashboard ✓
```

**Why this flow is the core:** This sequence demonstrates the complete value loop — from chaotic group chat to structured decision — without anyone leaving LINE. It proves that the AI can understand context, present actionable options, drive group consensus, and maintain a persistent record. If this flow works smoothly, every subsequent feature (on-trip suggestions, bill splitting, itinerary export) is an extension of the same pattern.

**High-risk drop-off points:**
- **Step 1 → Step 2:** If the bot's welcome message is confusing or too long, the organizer may never complete setup. The onboarding must be under 3 taps.
- **Step 3 → Step 4:** If Flex Message cards look cluttered or load slowly, passive members won't engage. Visual quality and load time are critical.
- **Step 4 (nudge):** If nudge messages feel spammy or annoying, members may mute or remove the bot. Tone and frequency calibration is essential.

### User Stories

| # | As a... | I want to... | So that... | Priority |
|---|---------|--------------|------------|----------|
| 1 | Group organizer | Add the bot to my LINE group and set trip dates/destination | The AI knows the context and starts helping immediately | P0 |
| 2 | Group organizer | See a structured dashboard of all trip items (to-do / pending / confirmed) | I know exactly what's decided and what's still open | P0 |
| 3 | Group member | Vote on options via visual cards without reading the full chat history | I can participate in decisions in under 10 seconds | P0 |
| 4 | Group organizer | Have the AI auto-extract dates, locations, and flight numbers from chat | I don't need to manually copy information into a separate tool | P0 |
| 5 | Group member | Receive gentle reminders when I haven't voted on a pending decision | I stay engaged without feeling harassed | P0 |
| 6 | Group organizer | Trigger a vote or poll on any open item with one command | I can move stalled discussions forward instantly | P0 |
| 7 | Group member | View the full trip itinerary on a visual timeline (LIFF) | I have a clear picture of the confirmed plan at any time | P1 |
| 8 | Group organizer | Export the confirmed itinerary as a shareable PDF or calendar sync | I can distribute the final plan to everyone easily | P1 |
| 9 | Group member | Get contextual restaurant/activity suggestions during the trip | The group can make quick decisions on the go | P1 |
| 10 | Group organizer | See an auto-generated expense split after the trip | Bill splitting is transparent and doesn't create awkwardness | P2 |

*P0 = Must-have for MVP, P1 = Important, P2 = Nice-to-have*

---

## 3. Requirements

### 3.1 Functional Requirements (P0 — MVP)

#### Feature 1: Semantic Chat Parsing Engine
- **Description:** Continuously monitors LINE group messages and extracts structured travel-relevant information (dates, destinations, flight numbers, hotel names, dietary restrictions, preferences) using LLM-powered natural language understanding. This is the "brain" that turns chaotic chat into actionable data.
- **Functional Requirements:**
  - FR-01: Parse incoming LINE group messages in real-time and identify travel-relevant entities (dates, locations, flight codes, hotel names, food preferences, budget mentions)
  - FR-02: Maintain a per-group context window that understands conversational references (e.g., "that place Jason mentioned yesterday" resolves correctly)
  - FR-03: Detect and flag conflicting information (e.g., two different departure dates mentioned by different members)
  - FR-04: Support Traditional Chinese (zh-TW) as primary language, with mixed Chinese-English input handling
  - FR-05: Ignore irrelevant messages (memes, stickers, off-topic chat) without false-positive extraction
- **Constraints & NFRs:** Message parsing latency must be < 3 seconds. LLM API costs must stay under NT$0.5 per message on average. Must handle groups of up to 30 members.
- **Acceptance Criteria:**
  - [ ] Given a group chat containing "我們7/15-7/20去大阪", the system extracts destination: Osaka, dates: 2026-07-15 to 2026-07-20
  - [ ] Given mixed messages with memes and stickers interspersed, the system only extracts travel-relevant content
  - [ ] Given conflicting dates from two members, the system flags the conflict and creates a pending decision item

#### Feature 2: Three-Stage Status Board (To-Do → Pending → Confirmed)
- **Description:** A persistent, structured kanban-style board that tracks every trip planning item through three stages. This replaces the need to scroll through hundreds of messages to understand trip status.
- **Functional Requirements:**
  - FR-06: Automatically create To-Do items from parsed chat (e.g., "insurance" mentioned → To-Do item created)
  - FR-07: Move items to "Pending" when a vote or discussion is actively in progress
  - FR-08: Move items to "Confirmed" when a decision is finalized, auto-attaching booking references, addresses, and confirmation numbers
  - FR-09: Allow organizer to manually create, edit, move, or delete items via bot commands
  - FR-10: Display the board via a LIFF page accessible from a persistent rich menu button
  - FR-11: Proactively remind the organizer about stale To-Do items that haven't been discussed after 48 hours
- **Constraints & NFRs:** Board state must persist across bot restarts. Board must load in < 2 seconds on LIFF.
- **Acceptance Criteria:**
  - [ ] When a user mentions "we need to book insurance", a To-Do item "Travel Insurance" appears on the board
  - [ ] When a vote is initiated for a hotel, the item moves from To-Do to Pending with a vote progress indicator
  - [ ] When voting concludes, the item moves to Confirmed with the winning option's details attached

#### Feature 3: Flex Message Visual Decision Cards
- **Description:** When a decision needs to be made (hotel, restaurant, activity), the bot generates visually rich LINE Flex Message cards with photos, ratings, prices, and inline vote buttons — enabling members to compare and vote without leaving the chat.
- **Functional Requirements:**
  - FR-12: Generate horizontally-swipeable Flex Message carousels with up to 5 options per decision
  - FR-13: Each card displays: photo, name, star rating, price range, walking distance/travel time, and a "Vote" button
  - FR-14: Aggregate data from public sources (Google Places API, OTA partner APIs) to populate card content
  - FR-15: Track votes per user (one vote per decision, changeable until voting closes)
  - FR-16: Display real-time vote count on each card
  - FR-17: Auto-close voting when majority is reached or after organizer-set deadline (default: 24 hours)
- **Constraints & NFRs:** Flex Messages must render correctly on LINE iOS and Android (test against LINE SDK v13+). Image loading must use CDN-cached thumbnails.
- **Acceptance Criteria:**
  - [ ] Organizer types "/vote hotel" and receives a carousel of 3–5 hotel options with photos and vote buttons
  - [ ] Each member can tap "Vote" on one option; tapping another option changes their vote
  - [ ] After majority vote, bot announces the winner and moves the item to Confirmed

#### Feature 4: Organizer Bot Commands
- **Description:** A set of slash-commands that give the organizer control over trip management — triggering votes, adding items, setting deadlines, and viewing summaries.
- **Functional Requirements:**
  - FR-18: `/start [destination] [dates]` — Initialize a new trip and set core parameters
  - FR-19: `/vote [item]` — Trigger a visual vote for a specific To-Do item
  - FR-20: `/status` — Display a summary of all items across the three stages
  - FR-21: `/nudge` — Send a reminder to all members with outstanding votes or unresolved items
  - FR-22: `/add [item]` — Manually add a To-Do item
  - FR-23: `/help` — Display available commands with brief descriptions
- **Constraints & NFRs:** Commands must respond within 2 seconds. Unrecognized commands should return a friendly error with the `/help` suggestion.
- **Acceptance Criteria:**
  - [ ] `/start Osaka 7/15-7/20` creates a trip and confirms the setup with a summary card
  - [ ] `/status` returns a formatted message showing counts and items per stage
  - [ ] An unrecognized command like `/foo` returns "I didn't catch that! Type /help to see what I can do."

#### Feature 5: LINE Bot & LIFF Infrastructure
- **Description:** The foundational LINE integration layer — webhook handling, user authentication, LIFF app hosting, and rich menu configuration that ties everything together.
- **Functional Requirements:**
  - FR-24: Receive and process LINE webhook events (message, follow, unfollow, join, leave)
  - FR-25: Authenticate users via LINE Login within the LIFF context (no separate registration)
  - FR-26: Serve the LIFF app (status board + itinerary view) as a full-screen web app within LINE
  - FR-27: Configure a persistent rich menu with buttons: "Dashboard", "Itinerary", "Help"
  - FR-28: Handle multi-group support — one user can be in multiple trip groups simultaneously
- **Constraints & NFRs:** Webhook must respond with 200 OK within 1 second (LINE platform requirement). LIFF app must be mobile-responsive and support LINE's in-app browser.
- **Acceptance Criteria:**
  - [ ] Bot correctly joins a group and sends the welcome message when invited
  - [ ] Users can open the LIFF dashboard from the rich menu without additional login
  - [ ] A user in 3 different trip groups sees separate dashboards for each group

### 3.2 Edge Cases & Error Handling

| Scenario | Expected Behavior |
|----------|-------------------|
| Bot is added to a group with an ongoing conversation (200+ prior messages) | Bot does not attempt to parse historical messages. Starts fresh with a welcome message and only parses messages from that point forward. |
| Two members post conflicting dates simultaneously ("let's go 7/15" vs "I can only do 7/20") | AI flags the conflict as a new Pending decision item: "Trip dates — conflicting preferences detected" with both options presented for a vote. |
| A member sends a message in a language other than Chinese or English (e.g., Japanese) | Bot gracefully ignores messages it cannot parse. Does not create garbage data items. |
| LINE webhook fails or is delayed (platform outage) | Messages are queued and processed when connectivity resumes. No data loss. Users see no error message — processing happens silently. |
| Organizer removes the bot from the group | All trip data is retained in the database for 90 days. If re-added, the organizer is prompted to resume or start fresh. |
| Group has only 2 members (below the 3-person target) | Bot still functions normally but adjusts voting language ("Both of you agree!" instead of "Majority reached!"). |
| Vote is tied after deadline | Bot notifies the group of the tie, extends voting by 12 hours, and asks the organizer to break the tie if still unresolved. |
| AI misparses a message (extracts wrong entity) | Users can react with ❌ to any bot-generated item, triggering a "Did I get this wrong?" prompt with an edit option. |
| LIFF page fails to load (network error) | Show a friendly error state: "Having trouble loading. Tap to retry." with a retry button. Fallback: send a text-based status summary in chat. |
| LLM API rate limit or outage | Queue requests with exponential backoff. For user-facing commands, respond within 5 seconds with "Let me think about that..." and deliver the result asynchronously. |

### 3.3 Analytics & Telemetry Requirements

| Event Name | Trigger | Properties | Purpose |
|------------|---------|------------|---------|
| `bot_added_to_group` | Bot joins a LINE group | `group_id`, `member_count`, `inviter_user_id` | Track adoption and group size distribution |
| `trip_created` | Organizer runs `/start` | `group_id`, `destination`, `trip_duration_days`, `member_count` | Measure activation — first meaningful action |
| `message_parsed` | AI extracts entity from chat | `group_id`, `entity_type` (date/location/flight/preference), `confidence_score` | Monitor parsing accuracy and entity distribution |
| `vote_initiated` | Vote carousel is sent | `group_id`, `item_type` (hotel/restaurant/activity), `options_count` | Track decision-making frequency |
| `vote_cast` | Member taps a vote button | `group_id`, `user_id`, `item_id`, `time_since_vote_initiated` | Measure engagement speed and participation rate |
| `vote_completed` | Decision is finalized | `group_id`, `item_id`, `participation_rate`, `time_to_decision_hours` | Core metric: how fast groups reach decisions |
| `liff_opened` | User opens the LIFF dashboard | `group_id`, `user_id`, `page` (board/itinerary), `source` (rich_menu/deep_link) | Track LIFF engagement |
| `nudge_sent` | Reminder is sent to non-voters | `group_id`, `pending_voters_count` | Monitor nudge frequency and necessity |
| `nudge_conversion` | User votes within 1 hour of nudge | `group_id`, `user_id`, `minutes_after_nudge` | Measure nudge effectiveness |
| `bot_removed` | Bot is removed from group | `group_id`, `trip_stage`, `days_since_added` | Track churn and identify failure points |

### 3.4 Post-MVP Features (P1/P2)
- **Visual itinerary timeline (LIFF):** Full-screen map + timeline view of confirmed items with drag-to-reorder — P1
- **On-trip contextual suggestions:** AI recommends restaurants/activities based on group size, time, location, and dietary restrictions — P1
- **OTA affiliate integration:** Embed Booking.com / Klook / KKday booking links in Flex cards with affiliate tracking — P1
- **Itinerary export:** Generate PDF handbook or sync to Google Calendar / Apple Calendar — P1
- **Smart bill splitting:** Detect payment-related messages, auto-calculate splits, generate LINE Pay transfer links — P2
- **Flight monitoring:** Track flight status changes and notify the group of delays/gate changes — P2
- **Multi-language support:** Add English and Japanese UI for international groups — P2
- **Repeat trip templates:** Save a past trip's structure as a template for future trips — P2

---

## 4. Constraints

### Performance
| Requirement | Target |
|-------------|--------|
| LINE webhook response time | < 1 second (LINE platform requirement) |
| Bot command response time | < 2 seconds (user-facing) |
| Chat message parsing latency | < 3 seconds (background) |
| LIFF dashboard load time | < 2 seconds on 4G |
| Flex Message card rendering | < 1.5 seconds including image load |
| Concurrent active groups | Support 1,000 simultaneously active groups in MVP |

### Security
| Requirement | Details |
|-------------|---------|
| Authentication | LINE Login via LIFF SDK (OAuth 2.0). No custom passwords. |
| API security | LINE Channel Secret for webhook signature verification; all API endpoints require valid LINE user token |
| Data encryption | AES-256 at rest for user data; TLS 1.3 for all transit |
| Rate limiting | 60 bot commands per minute per group; 10 commands per minute per user |
| Secrets management | All API keys and tokens stored in environment variables, never in codebase |

### Privacy & Compliance
- **Applicable regulations:** Taiwan PDPA (Personal Data Protection Act); if expanding to Japan/Thailand, APPI and PDPA (Thailand) respectively
- **PII handling:** LINE user IDs are pseudonymous. Display names are cached but not indexed. Message content is processed for entity extraction only — raw messages are not stored permanently. Parsed entities are stored with group-level association, not individual attribution.
- **Data retention:** Parsed trip data retained for 90 days after trip end date. User accounts deleted 30 days after deactivation. Raw message logs purged after 7 days.
- **Consent requirements:** Bot sends a privacy notice on first group join. Users can opt out of parsing by replying `/optout`. Marketing messages require explicit opt-in.
- **Data residency:** All user data stored in Taiwan-region cloud infrastructure (GCP asia-east1 or AWS ap-northeast-1).

### Localization & Accessibility
- **Languages:** Primary: zh-TW (Traditional Chinese). Bot commands accept both Chinese and English aliases.
- **Accessibility:** LIFF pages follow WCAG 2.1 AA — sufficient color contrast, readable font sizes (min 14px), touch targets ≥ 44px.

---

## 5. Technical Implementation (Reference)

> **Note:** This section is a reference for engineering, not a mandate. Engineers often prefer to design the schema and architecture themselves based on the requirements above. Treat this as "Proposed — Reference Only."

> **MVP Philosophy:** Development speed is the primary constraint. Choose tools that let a small team ship in days, not weeks. Prefer managed services that eliminate configuration overhead.

### Recommended Tech Stack

| Layer | Technology | Rationale |
|-------|------------|-----------|
| Frontend (LIFF) | Next.js + Tailwind CSS | Full-stack framework with SSR. LIFF pages are just web pages — Next.js gives us routing, API routes, and fast iteration. Tailwind keeps UI development rapid. |
| Backend / API | Next.js API Routes + Node.js | Eliminates a separate backend service. LINE webhook handler, bot logic, and LIFF API all live in one deployable unit. |
| LLM Integration | OpenAI GPT-4o / Claude API | For semantic parsing of chat messages. Use structured output (JSON mode) to ensure reliable entity extraction. |
| Database | Supabase (PostgreSQL) | Managed Postgres with built-in auth helpers, real-time subscriptions (for live dashboard updates), and row-level security. Free tier sufficient for MVP. |
| Hosting | Vercel | Zero-config CI/CD with preview URLs. Optimized for Next.js. Handles LIFF hosting and API routes in one deployment. |
| Messaging SDK | LINE Messaging API + LIFF SDK v2 | Official SDKs for bot interactions, Flex Messages, and in-app web views. |
| Image CDN | Cloudinary (free tier) | Resize and cache hotel/restaurant images for Flex Message cards. Keeps card load times fast. |

### System Architecture Overview
The system operates as a Next.js application deployed on Vercel with three primary interfaces: (1) a LINE webhook endpoint that receives group messages and bot commands, processes them through the LLM parsing pipeline, and responds with Flex Messages or text; (2) a set of API routes that serve the LIFF dashboard and itinerary views, reading from and writing to Supabase; and (3) a background job system (Vercel Cron or Supabase pg_cron) that handles scheduled nudges, vote deadline enforcement, and stale item reminders. The LLM is called via API for each relevant message, with a context window maintained per group in the database to enable conversational understanding. External data (restaurant/hotel options) is fetched on-demand from Google Places API and cached in Supabase.

### API & Third-Party Integrations
| Integration | Purpose | Notes |
|-------------|---------|-------|
| LINE Messaging API | Send/receive messages, Flex Messages, rich menus | Free tier: 500 messages/month; paid plans scale as needed |
| LINE LIFF SDK v2 | Embed web apps within LINE, access user profile | No additional cost |
| OpenAI API (GPT-4o) | Semantic parsing of chat messages into structured entities | ~$0.01 per message parse; budget ~NT$15,000/month for beta |
| Google Places API | Fetch restaurant/hotel data (photos, ratings, location) | $200/month free credit; pay-as-you-go beyond |
| Supabase | Database, auth, real-time subscriptions | Free tier: 500MB DB, 50,000 monthly active users |
| Vercel | Hosting, CI/CD, serverless functions, cron jobs | Free tier sufficient for MVP; Pro plan ($20/mo) for production |

### Key Technical Decisions & Trade-offs
- **LLM for parsing vs. regex/NER:** We chose LLM-based parsing despite higher cost because group travel conversations are highly contextual and colloquial. Rule-based systems would require constant maintenance for the variety of ways people express travel plans in Chinese. Trade-off: higher per-message cost (~NT$0.3–0.5) but dramatically better accuracy.
- **LIFF over custom web app:** Using LIFF means we're constrained by LINE's in-app browser limitations (no push notifications from LIFF, limited WebGL). Trade-off: we sacrifice some UI richness for zero-friction access (no URL sharing, no login needed).
- **Supabase over Firebase:** PostgreSQL's relational model maps better to our data (groups → trips → items → votes). Firebase's document model would require more complex queries for the status board. Trade-off: slightly less real-time performance but much cleaner data relationships.
- **Single Next.js app over microservices:** All logic in one deployable unit reduces operational complexity for a small team. Trade-off: if the LLM parsing pipeline becomes a bottleneck, it may need to be extracted into a separate service later.

---

## 6. Strategy & Success

### Strategic Assumptions

| # | Assumption | How to Test | Invalidation Signal |
|---|-----------|-------------|---------------------|
| 1 | Group organizers (主揪) will invite a bot into their friend group for trip planning | Offer the bot to 50 organizers via LINE OA and travel communities | < 20% add the bot to their group within 1 week |
| 2 | Passive members ("都可以" types) will engage with visual vote cards | Track vote participation rate across first 100 decisions | < 40% of group members vote on any given decision |
| 3 | AI can accurately extract travel entities from colloquial Chinese chat | Run parsing on 500 real group chat messages (with consent) | Entity extraction accuracy < 75% (precision) |
| 4 | Users will trust an AI bot enough to keep it in their friend group | Monitor bot removal rate over 30-day period | > 50% of groups remove the bot within 2 weeks |
| 5 | The organizer's pain is severe enough to drive word-of-mouth growth | Measure organic group additions (not from marketing) | < 10% of new group additions come from referrals after month 2 |

### Pivot Triggers
If after reaching 200 active groups, the average vote participation rate is below 30% and the Day-7 group retention is below 20%, the core hypothesis — that passive group members will engage with structured decision tools — is likely invalid. In that case, we should investigate pivoting to a B2B model (travel agencies using the bot to manage client groups) or shifting to a personal AI travel assistant rather than a group coordination tool. Similarly, if LLM parsing costs exceed NT$2 per message at scale without a clear path to optimization, we should evaluate switching to a hybrid NER + rules approach.

### Success Metrics

| Metric | Target | Measurement Method |
|--------|--------|-------------------|
| Group activation rate (bot added → first `/start`) | > 60% within 48 hours | Analytics funnel: `bot_added_to_group` → `trip_created` |
| Vote participation rate | > 50% of group members per decision | `vote_cast` events / group `member_count` |
| Time to decision | < 12 hours median (from vote initiated to completed) | `vote_completed.time_to_decision_hours` |
| Organizer satisfaction (NPS) | > 40 | In-bot survey after trip completion |
| Day-7 group retention | > 35% | Groups with any activity 7 days after bot addition |
| Day-30 group retention | > 20% | Groups with any activity 30 days after bot addition |
| Parsing accuracy (precision) | > 85% | Manual review of random sample (100 messages/week) |
| Bot removal rate | < 25% within first trip cycle | `bot_removed` events / `bot_added_to_group` events |

### Rollout Plan

| Phase | Audience | Goal | Duration |
|-------|----------|------|----------|
| Alpha | Internal team + 5 friendly groups | Validate core parsing and voting flow; identify critical bugs | 2 weeks |
| Closed Beta | 50 groups recruited from travel communities (PTT Travel, Dcard) | Validate product-market fit; tune AI parsing accuracy; measure engagement metrics | 6 weeks |
| Open Beta | Public LINE OA with organic growth + targeted social media (IG, Threads) | Scale to 500+ groups; validate retention and referral metrics; begin OTA integration testing | 8 weeks |
| GA Launch | General availability with PR push and influencer partnerships | Achieve 2,000+ active groups; activate affiliate revenue stream | Ongoing |

---

*End of PRD — TravelSync AI v1.0*
# TravelSync AI — UI/UX Design Specification

**Version 1.0 · June 2026 · Author: Product Design / UX Architecture**
**Status: Proposed evolution of the shipped `/app` surface (not a rewrite)**

This specification is grounded in the current codebase: the bento workspace (`components/app/trip-bento-page.tsx`, 11+ tiles), orchestrator mode (`trip-orchestrator-mode.tsx`), the eight grid agents (`services/agents/registry.ts`) with the three-state autonomy dial (`AutonomyChip`), the ghost lane (`orchestrator_actions`, `grids/ghost-lane.tsx`), and the existing token layer in `app/globals.css` (Tailwind v4 `@theme inline`). Every recommendation maps to a real component, table, or token.

---

## 1. Core Design Philosophy, Applied

### 1.1 Functional Minimalism — "One decision per viewport"

The unit of value in this product is a **resolved decision**: a `trip_items` row moving `todo → pending → confirmed`. Every layout choice is judged by whether it moves an item toward `confirmed` with less cognitive load.

- **Decision friction budget (hard rules):**
  - Max **1 primary CTA per tile**. Secondary actions demote to ghost buttons or the overflow menu.
  - Max **3 AI proposals visible** per viewport without explicit expansion (the current `AIUpdatesTile` cap of 6 is reduced to 3 + "view all").
  - Destructive or irreversible actions never share a visual tier with confirmations — `destructive` button variant only inside a confirmation surface, never inline in a card row.
- **Whitespace is hierarchical, not decorative.** 8-pt rhythm throughout. Tile interior padding 20px; gap *inside* a related cluster 12px; gap *between* unrelated clusters 24px. Grouping must read pre-attentively, before any label is parsed.
- **Predictable defaults, visibly provisional.** Every form pre-fills from trip context: dates from `trips.start_date/end_date`, currency from destination, expense splits = equal across `trip_members`. Pre-filled values render with a **dotted underline + muted tone** until the user touches them — a pre-fill is a suggestion, never a fait accompli. On first touch the underline solidifies (motion spec §3.6, row 9).
- **Content hierarchy beats density.** The bento canvas has exactly three altitude bands (§3.2): *Decide* (above the fold, always), *Track* (mid), *Ambient* (below). Nothing in the Ambient band may demand action.

### 1.2 Ambient & Transparent AI — "AI is a lane, not a widget"

There is **no floating chat bubble** in the workspace. The orchestrator and the eight agents reach the user through exactly three channels:

1. **The ghost lane** — pending `orchestrator_actions` and agent proposals render as translucent cards *adjacent to the tile they would mutate* (a proposed hotel appears at the edge of the Decision Center, a proposed packing item at the edge of the Pack tile) — not in a detached inbox. Spatial adjacency *is* the explanation of scope.
2. **Ambient tiles** — monitor-mode agents (`flight-price-tracker`, `weather-forecast`, `hotel-price-watch`, `social-media-photos`) write into their own bento tiles via `custom_grids.last_output`. Data, not conversation.
3. **Pre-fill & ranking** — `services/parsing/` extraction and `consensus-radar` adjust defaults and ordering *inside* existing components (action queue priority, vote option ordering), always with a provenance marker.

- **Logic transparency is structural, not optional.** Every machine-authored element carries a provenance affordance (`components/app/grids/provenance.tsx`): **which agent · which run · which source message · confidence**. One tap opens the "why" popover ("Proposed because 4 of 6 members mentioned Shibuya, and your hotel vote closes Friday"); a second tap opens the raw run record (`orchestrator_runs.transcript`). If a "why" cannot be written for a suggestion, the suggestion does not ship.
- **The override mechanism is absolute and three-tiered:**
  - **Per-action:** every proposal card offers *Confirm / Edit-before-apply / Dismiss*. Every `auto_apply_with_undo` action shows a 10-second undo toast, and `orchestrator_actions.status = 'undone'` is a first-class, visible state in the run log — undo is never silent cleanup.
  - **Per-tool / per-agent:** the autonomy dial (`propose_only → auto_apply_with_undo → auto_apply`) on every grid (`AutonomyChip`) and every orchestrator tool (`trip_orchestrators.tool_autonomy`). Surfaced in the UI, not just server-side (§3.5.2).
  - **Per-trip:** a single **Pause AI** switch in the workspace header (backed by `trip_orchestrators.enabled` + `custom_grids.is_active`). One tap silences all autonomous behavior; ambient tiles keep their last data with a "paused" badge. Re-enable restores everything — pausing never loses state.

### 1.3 Materiality — Liquid Glass, adapted to a paper-warm system

The shipped language is **warm paper** (`--surface-base: #fbfaf6`). We keep it, and assign glass a *semantic* job rather than spreading it everywhere:

> **Glass is the material of the machine and of transient chrome. Paper is the material of human-confirmed reality.**

- AI proposals, the command palette, sticky navigation, the grids rail, and modal scrims are glass. Confirmed itinerary items, settled expenses, and cast votes are opaque paper. **If it's translucent, it isn't real yet.** The confirm gesture literally turns glass into paper (§3.6, row 1) — the material system teaches itself in one interaction.
- **Adaptive transparency:** glass surfaces tint from the content beneath them. Each bento tile publishes a scoped CSS variable `--tile-dominant` (its accent hue); overlying glass composites it via `color-mix(in oklab, var(--glass-2-bg) 88%, var(--tile-dominant) 12%)`. As the user scrolls, sticky chrome subtly shifts tint with the band beneath it — alive, without skeuomorphism.
- **Refraction without kitsch:** a 1px specular top edge (`--glass-edge`), `saturate(1.4–1.6)` lift behind the blur, and an optional 2%-opacity SVG noise grain on tier-3 surfaces only. No bevels, no thick borders, no fake caustics.
- **A four-tier elevation ladder** (tokens §4.4) with a strict compositing budget: **never more than 3 blurred layers on screen, never nested blurs** (§5.3).

### 1.4 Functional Motion — "Motion is a state-change receipt"

Every animation must answer one of three questions: *Did it happen? Where did it go? What changed?* Anything else is cut.

- Springs already exist in the token layer (`--spring-snappy`, `--spring-gentle`); §3.6 binds each interaction to exactly one duration/easing pair.
- Hard caps: **380ms** for layout-level morphs, **220ms** for micro-confirmations, **140ms** for hover/press. The only thing allowed to exceed 380ms is a *decaying* afterglow (`--duration-glow: 1200ms`) which never blocks input.
- The signature move — **proposal → reality**: confirming a ghost card morphs it into its destination tile (translate + de-blur + opacity → 1, `--spring-gentle`, 380ms), with a green settle-glow that decays over 1200ms. This single gesture teaches material semantics, spatial hierarchy, and trust.

---

## 2. User Flow & Intent Mapping

### 2.1 Primary persona & the retention loop

**The Organizer running the "Sunday-evening loop."** A LINE group has been chattering all week; the organizer opens the web workspace 2–4× a week to triage what the group and the agents produced. Retention is driven not by time-in-app but by **resolution velocity** — how fast a session converts pending items into confirmed ones. Members run a lighter loop: deep-link in, vote, leave.

### 2.2 The high-retention journey (annotated)

```
TRIGGER ──► ARRIVE ──► ORIENT ──► RESOLVE (loop) ──► RECEIPT ──► EXIT HOOK
 LINE         /app       Hero +      Ghost lane,        Morph +      Next-Up tile +
 notification  trips/[id] Action      votes, expenses    readiness    agent schedule
 or digest     ?scroll=…  Queue                          delta
```

1. **Trigger.** A LINE notification ("Hotel vote closes Friday — 2 of 6 voted") or an agent digest deep-links to `/app/trips/[tripId]?scroll=votes`. The existing scroll-anchor redirect pages (`/votes`, `/expenses`, `/board`, `/pack`, `/ideas` → `?scroll=` anchors) are the **intent-handoff mechanism**: the link encodes the intent, the workspace lands focused (§3.3.1). Cold-start latency budget: interactive shell < 1.5s on 4G.
2. **Arrive & orient (0–5 seconds).** The hero tile (`trip-hero-tile.tsx`) answers *where/when/who*; the Action Queue (`trip-action-queue.tsx`) answers *what needs me*, ranked, top 3 only. A one-line **delta strip** under the hero answers *what changed since I left*: "Since Tuesday: flight price ↓ NT$1,840 · 2 new proposals · Kenji paid the ryokan deposit." Composed from `custom_grid_runs`, `orchestrator_actions`, and `expenses` since the user's last session — this is the single highest-retention element on the page.
3. **Resolve loop (the session core).** Triage ghost-lane proposals (confirm / edit / dismiss), cast or close votes (`trip-decision-center.tsx`), settle expenses. Each resolution updates the Action Queue *in place* — the next item slides up (`--spring-snappy`, 220ms); the user never re-orients.
4. **Receipt.** Every resolution produces a material receipt: the morph animation plus a **readiness delta** ("2 more decisions until your itinerary locks") tied to the readiness model. Progress is framed against the *trip*, not against app engagement.
5. **Exit hook.** The Next-Up tile (`trip-next-up-tile.tsx`) surfaces the next deadline; the system states what the agents will do in the meantime: "Flight tracker checks again at 06:00; consensus radar will nudge non-voters Thursday." The user leaves knowing the machine is on duty — that is the ambient-AI retention promise.

### 2.3 Intent map

| User intent | Entry signal | System response | AI involvement | Override |
|---|---|---|---|---|
| "Start a trip" | `/app/trips/new` or LINE `/start` | Wizard pre-fills from any parsed group chatter (destination, date window) | `services/parsing/` extraction, marked provisional | Every field editable; dotted-underline provisional styling until touched |
| "Throw in an idea" | Paste a URL / free text in chat or Ideas tile | Item lands in `todo` stage, enriched (place data, price) asynchronously | `chat-digest` agent extracts from LINE; enrichment via place lookup | Dismiss enrichment; raw text always preserved |
| "Decide between options" | `?scroll=votes` deep link; Action Queue card | Decision Center with options ranked; deadlock detection | `consensus-radar` proposes tie-breaks / nudges (propose-only by design) | Organizer closes or reopens any vote manually |
| "Track money" | `?scroll=budget`; `/exp` in LINE | Finance panel: ledger + "who owes whom" settlement graph | Split suggestion (equal by default); anomaly flag on outliers | Edit any split; flags are dismissible, never blocking |
| "Am I ready?" | Readiness card; `/ready` in LINE | Checklist computed from `confirmed` items + `booking_status` | Orchestrator proposes missing pieces (insurance, transfers) | Mark any line "not needed" — suppression is remembered |
| "What changed since I left?" | Opening the workspace | Delta strip (§2.2 step 2) | Digest composed from agent runs + actions log | Tap any delta line → provenance popover |
| "Plan it for me" | Orchestrator mode toggle; goal editor | Goal → plan tree → tool runs → ghost-lane actions | Full orchestrator loop (max 8 turns), bounded by per-tool autonomy | Autonomy dial per tool; Pause AI per trip; undo per action |

### 2.4 AI edge cases — explicit UX contracts

| # | Edge case | Detection | UX behavior | Never |
|---|---|---|---|---|
| 1 | **Low-confidence extraction** | `parsed_entities` confidence < 0.6 | Ghost card with confidence meter + the original quoted message ("From Mei, Tue 21:14: 『或者去福岡？』"). Quote is the explanation. | Silently pre-fill or auto-create from low-confidence parses |
| 2 | **Conflicting entities** (two date ranges, two destinations) | Parser emits `conflict` entity | A *conflict card* presenting both readings → one-tap "make this a vote" | Pick a winner silently |
| 3 | **Agent run failure** | `custom_grids.last_status = 'failed'` | Tile keeps last good `last_output`, adds a quiet "as of {last_run_at}" stale badge + retry affordance; `last_error` lives in the provenance popover | Blank the tile, or surface a raw error string as primary content |
| 4 | **Stale monitor data** | `now − last_run_at > 2 × frequency_hours` | Timestamp badge shifts to `--status-needs-decision` amber; "Run now" affordance | Present stale prices as current |
| 5 | **Proposal flood** | > 3 pending proposals for one tile | Batch into one digest card: "Itinerary drafter has 5 suggestions → review" | Stack ghost cards down the page |
| 6 | **Auto-apply regret** | User hits undo within toast window, or later in the log | `status = 'undone'` shown in run history with who/when; the dial for that tool gets a one-tap "drop to propose-only" suggestion after 2 undos | Hide undone actions; argue with the user |
| 7 | **Deadlocked vote** | `consensus-radar` pattern match | Nudge proposal ("3-way tie for 5 days — suggest ranked-choice runoff?") addressed to the organizer | Auto-decide a vote. Ever. |
| 8 | **Hallucinated place** | Option lacks a `provider` ref (`trip_item_options.provider = 'manual'` from an LLM) | Card carries "unverified" chip; `booking_status` cannot advance until verified through `place-picker.tsx` | Let an unverified entity reach the booking flow |
| 9 | **LLM latency** | Response > 4s budget | Three-stage ladder: optimistic shell (<100ms) → skeleton shimmer (≤1 cycle) → cached content + stale badge at 4s. Tiles never block interaction (§5.4) | Spinner-lock the workspace on any model call |
| 10 | **Total LLM outage** | Circuit breaker in `lib/gemini.ts` open | All AI affordances collapse to a single "AI paused — your trip is unaffected" pill; CRUD, votes, expenses fully functional | Degrade core (non-AI) functionality because a model is down |

---

## 3. Layout & Component Architecture

### 3.1 App shell — three zones (desktop), two (mobile)

```
┌────────────┬──────────────────────────────────────┬─────────────────┐
│  SIDEBAR   │            CANVAS                    │   GRIDS RAIL    │
│  264px     │            fluid                     │   320px         │
│  glass-1   │            paper                     │   glass-1       │
│  sticky    │  hero ▸ delta strip ▸ bento bands    │  agents +       │
│            │                                      │  dispatched     │
│  trips     │                                      │  tasks          │
│  inbox     │                                      │  (collapsible)  │
│  templates │                                      │                 │
└────────────┴──────────────────────────────────────┴─────────────────┘
```

- **Sidebar** (`app-sidebar.tsx`): glass-1, sticky. Trip switcher, inbox (badge count from `notifications.read_at IS NULL`), templates, profile. Collapses to icon rail at < 1280px.
- **Canvas**: the paper field. Hero tile → delta strip → bento bands. Max content width 1180px; the canvas, not the chrome, owns scroll.
- **Grids rail** (`trip-grids-rail.tsx`): glass-1. Agent grid list with status dots + autonomy chips, dispatched-task zone, "add agent" entry (`add-custom-grid-dialog.tsx`). Collapsible; collapsed state shows status dots only — ambient awareness at 24px width.
- **Mobile (< 768px):** single column. Sidebar becomes a bottom tab bar (glass-1): *Trip · Decide · Money · Chat · More*. Grids rail becomes a bottom sheet pulled from a status strip under the hero. The Action Queue docks as a one-line glass pill above the tab bar — thumb-reachable triage (§5.2).

### 3.2 Bento canvas — three altitude bands

Tile taxonomy and placement are **fixed by band, fluid within band** (users reorder within a band; bands never interleave):

| Band | Tiles (component) | Contract |
|---|---|---|
| **Decide** (always above fold) | Action Queue (`trip-action-queue`), Decision Center (`trip-decision-center`), AI Updates / ghost lane (`trip-ai-updates`) | May demand action. Primary CTAs allowed. Max 3 visible proposals. |
| **Track** | Finance (`trip-finance-panel`), Itinerary (`trip-itinerary`), Packing (`trip-pack`), Next-Up (`trip-next-up-tile`) | Shows state + deltas. CTAs are secondary. |
| **Ambient** | Weather, flight/hotel price trackers, social photos (`grids/custom-grid` per agent), Map (`trip-map-panel`) | **May never demand action.** No badges, no CTAs — data and provenance only. |

- Grid: 12 columns, 24px gutters. Tile spans: Action Queue 12 (mobile) / 5 (desktop); Decision Center 7; Track tiles 4–6; Ambient tiles 3–4. Tile = `--radius-tile` (24px), `--shadow-raise`, paper surface.
- **Density modes:** *Comfortable* (default) and *Focus* (auto-engaged during trip dates: Ambient band collapses to a single summary strip; Decide band enlarges). Persisted per user per trip in localStorage alongside the existing mode toggle in `trip-workspace.tsx`.

### 3.3 Contextual layout shifting — real-time behaviors

1. **Anchor focus** (deep-link arrival, `?scroll=votes` etc.): target tile scrolls into view and expands one span step (380ms, `--spring-gentle`); all other tiles drop to 0.92 opacity and −20% saturation for 1.2s, then recover. Direction of attention is taught by the layout itself, not by a tooltip.
2. **Orchestrator mode morph** (`trip-workspace.tsx` toggle): bento tiles don't cut away — they **collapse toward the hero** (shared-element: the hero persists, tiles scale to 0.96 and fade 220ms staggered 20ms), and the plan tree (`trip-orchestrator-mode.tsx`) unfolds beneath it on a glass-3 field over a deep-tone backdrop (`--deep-petrol`, §4.3). The reverse morph restores tile positions exactly. The user's mental model: *same trip, deeper layer* — not *different page*.
3. **Ghost-lane adjacency:** proposal cards mount at the edge of their target tile with a 12px overlap, slightly rotated (−1°), glass-2. On hover/focus the target tile's border tints `--ai-authored-soft` — scope made visible before commitment.
4. **Sticky chrome adaptation:** on scroll past the hero, a condensed glass-1 header materializes (trip name set in the editorial serif, readiness %, Pause-AI switch). Its tint tracks `--tile-dominant` of the topmost visible band (§1.3).
5. **Chat ↔ workspace:** the trip chat (`trip-chat-room.tsx`) slides as a right-side glass-2 sheet over the canvas (not a route change), so proposal cards arriving in chat (`ProposalCard3D`) can be dragged—or one-tap "pinned"—into the workspace, becoming ghost cards on the relevant tile.

### 3.4 Adaptive transparency — mechanics

- Each tile sets `style={{ '--tile-dominant': … }}` from its semantic accent (Finance → `--accent-cool`, AI Updates → `--ai-authored`, status tiles → their status hue).
- Glass recipe (tier 2 example, all tokens §4.4):
  `background: color-mix(in oklab, var(--glass-2-bg) 88%, var(--tile-dominant, transparent) 12%); backdrop-filter: blur(24px) saturate(1.6); box-shadow: var(--glass-edge), var(--shadow-raise); border: var(--glass-stroke);`
- Implemented as utilities in `app/globals.css` (the project's no-custom-CSS-files rule keeps tokens centralized there); consumed via Tailwind v4 arbitrary properties or small `@utility` blocks — **never per-component CSS**.

### 3.5 Component anatomy specs

#### 3.5.1 GhostCard (`grids/ghost-lane.tsx`) — the AI proposal unit
- Surface: glass-2, `--radius-lg`, max-width 360px, −1° resting rotation (0° on focus).
- Anatomy (top→bottom): **provenance eyebrow** (agent icon + name + relative time, 12px label, `--ai-authored`) → **title** (heading-sm) → **one-line rationale** (body-sm, muted; tap → provenance popover) → **confidence meter** (4px bar, mono percentage label — only when < 0.8; high confidence is asserted by silence) → **action row**: `Confirm` (primary), `Edit` (ghost), `Dismiss` (ghost, icon).
- States: *pending* (glass) · *confirming* (morph §3.6 row 1) · *editing* (expands inline to the relevant fields of `item-detail-dialog`) · *dismissing* (blur-out 180ms `--ease-exit`) · *auto-applied* (skips lane; appears directly in tile with violet provenance dot + undo toast).
- IDs: `ghost-card-{actionId}`, `ghost-card-{actionId}-confirm` / `-edit` / `-dismiss` (project unique-ID rule, §3.7).

#### 3.5.2 AutonomyChip — the dial made visible
- Pill (`--radius-pill`), three states (existing labels retained, EN/ZH_TW): `propose_only` "Suggest only / 僅建議" (outline, muted) → `auto_apply_with_undo` "Auto + undo / 自動 + 可復原" (filled `--ai-authored-soft`, violet text) → `auto_apply` "Full auto / 全自動" (filled `--ai-authored`, ink text).
- Click cycles forward (220ms `--ease-confirm` label crossfade + 4px slide). **Entering `auto_apply` requires an inline confirm** ("This agent will change the trip without asking — Allow / Cancel") rendered in-place, not a modal.
- New placement: besides each grid tile (shipped), the chip also renders per tool in orchestrator mode, exposing `trip_orchestrators.tool_autonomy` — closing the current gap where tool autonomy is server-side only.
- Always paired with a one-line plain-language consequence below the chip in settings contexts.

#### 3.5.3 ProposalCard3D (`chat/proposal-card-3d.tsx`) — constrained
- Pointer-tracked tilt capped at **4°**, glare opacity ≤ 0.15. Tilt disabled on touch devices and under `prefers-reduced-motion` (falls back to flat glass-2 with the same hierarchy). The 3D treatment is reserved for *chat* context where the card competes with message flow; inside the workspace, proposals are always flat GhostCards — one expressive register per context.

#### 3.5.4 Action Queue (`trip-action-queue.tsx`)
- Top 3 ranked rows; rank = (deadline proximity × blocking-degree × member-coverage), surfaced honestly: each row's overflow shows "Why is this first?" → the ranking factors in plain words. Ranking transparency is the same provenance contract as proposals.
- Row anatomy: leading status icon (never color-only), title (body, ink), context line (body-sm muted), trailing single CTA. Completing a row: it compresses to a 4px settled-green line then collapses (220ms) as the next slides up.

#### 3.5.5 Provenance popover (`grids/provenance.tsx`)
- Fixed schema, every machine-authored element: **Agent** (name + mode chip) · **Run** (relative time, link → run record / `orchestrator_runs` transcript) · **Inputs** ("read: 14 chat messages, weather 7-day, your votes") · **Confidence** (when applicable) · **Footer actions**: "Pause this agent" · "Change autonomy". The popover is the contract that AI never acts anonymously.

### 3.6 Micro-interaction specification

| # | Interaction | Motion | Duration / easing | Cognitive job |
|---|---|---|---|---|
| 1 | Confirm proposal | Ghost card translates into target tile, blur 24→0, opacity →1; tile pulses settle-green underglow decaying 1200ms | 380ms `--spring-gentle` + `--duration-glow` | "It's real now, and it lives *there*" |
| 2 | Dismiss proposal | Card blurs out + 8px downward drift | 180ms `--ease-exit` | "Gone, without ceremony" |
| 3 | Cast vote | Option bar elastically fills to new share; count ticks | 220ms `--spring-snappy` | Receipt + immediate social state |
| 4 | Autonomy cycle | Label crossfade + 4px horizontal slide; fill tier shifts | 220ms `--ease-confirm` | "I changed the rules of engagement" |
| 5 | Undo toast | Slides up; 10s radial countdown on the Undo button | enter 220ms; countdown linear | Recoverability made visible |
| 6 | Anchor focus | Target tile expands one span; siblings dim/desaturate then recover | 380ms `--spring-gentle` | Directs attention; teaches layout |
| 7 | Mode morph (bento ⇄ orchestrator) | Tiles collapse toward hero (stagger 20ms); plan tree unfolds on glass-3 | 380ms total | "Deeper layer, same place" |
| 8 | Agent run-now | Status dot → orbiting pulse; on success, tile content cross-fades and "as of" timestamp resets | pulse 1200ms loop; swap 220ms | Working / fresh, without a spinner |
| 9 | Provisional → owned field | Dotted underline solidifies; value ink shifts muted → primary | 140ms ease-out | "This value is yours now" |
| 10 | Numeric delta (prices, totals) | Count-up/down with sign-colored trail fading | 600ms ease-out | Change magnitude at a glance |

All rows degrade under `prefers-reduced-motion` per §5.3.

### 3.7 ID & testing contract

Per the project rule (every HTML element carries a unique ID), IDs follow a deterministic grammar so tasks, tests, and agent-driven UI references can target them:

```
{surface}-{component}-{entityId?}-{role?}
  bento-tile-votes              hero-pause-ai
  ghost-card-9f2c1-confirm      rail-grid-7a3b-autonomy
  queue-row-1-cta               delta-strip-line-2
```

Rules: lowercase kebab; entity IDs use the DB row id (short-hashed for length); role suffix only on interactive descendants; IDs are stable across re-renders (derived from data, never from render index — except ordinal display rows like `queue-row-1` where position *is* the semantic).

---

## 4. Design System Tokens & Aesthetics

All tokens land in `app/globals.css` (Tailwind v4 `@theme inline` + CSS custom properties) — the existing single source of truth. Values marked **(existing)** ship today; the rest are additive.

### 4.1 Typography — editorial serif over utility sans

The pairing: **Fraunces** (variable, optical-size axis) for editorial weight — the voice of *the trip* — over **Inter** for utility and **Space Grotesk** retained for component headings; **JetBrains Mono** for data. The serif is rationed: destination names, AI narrative summaries (delta strip, digest prose, orchestrator `last_summary`), empty-state editorial. It never appears in buttons, forms, tables, or labels.

```css
/* Fonts — loaded via next/font/google in app/layout.tsx */
--font-editorial: "Fraunces", "Noto Serif TC", serif;       /* NEW; opsz 9–144, SOFT axis 0 */
--font-display: "Space Grotesk", sans-serif;                 /* existing */
--font-body: "Inter", "Noto Sans TC", sans-serif;            /* existing */
--font-mono: "JetBrains Mono", monospace;                    /* existing */
```

| Token | Face / weight | Size / line-height / tracking | Used for |
|---|---|---|---|
| `--type-editorial-hero` | Fraunces 600, opsz 72 | 2.75rem / 1.1 / −1% | Trip destination in hero; orchestrator goal display |
| `--type-editorial-title` | Fraunces 560, opsz 36 | 1.75rem / 1.2 / −0.5% | Delta-strip lead, digest headlines, empty states |
| `--type-heading-lg` | Space Grotesk 600 | 1.25rem / 1.3 / 0 | Tile titles, dialog titles |
| `--type-heading-sm` | Space Grotesk 600 | 1rem / 1.4 / 0 | Card titles, section subheads |
| `--type-body` | Inter 400 (500 emphasized) | 0.9375rem / 1.6 / 0 | Default reading text |
| `--type-body-sm` | Inter 400 | 0.8125rem / 1.5 / 0 | Rationales, context lines |
| `--type-label` | Inter 500 | 0.75rem / 1.3 / +2% | Eyebrows, chips, provenance |
| `--type-data` | JetBrains Mono 500, `tabular-nums` | 0.8125rem / 1.4 / 0 | Prices, dates, counts, IDs, confidence % |

CJK rules: ZH_TW body line-height bumps to 1.7; no italics for emphasis in ZH (use weight 500/600); Fraunces falls back to **Noto Serif TC** so editorial register survives localization (`EN`/`ZH_TW` lockstep per `lib/docs/copy.ts` discipline).

### 4.2 Color — paper field, deep retro-futurist anchors, rationed vibrant highlights

Strategy: desaturated warm field (≤ 8% chroma) → deep saturated anchors for *depth moments* → vibrant accents strictly rationed to function. **One saturated accent per viewport region.**

```css
/* ── Surfaces (existing) ───────────────────────────────── */
--surface-base:   #fbfaf6;   --surface-raised: #ffffff;
--surface-sunken: #f5f3ec;   --surface-glass:  rgb(255 252 245 / 0.72);

/* ── Text (existing) ───────────────────────────────────── */
--text-primary: #14130f;  --text-secondary: #3a382f;
--text-muted:   #6e6a5f;  --text-faint:     #9a9485;

/* ── Deep field — retro-futurist anchors (NEW) ─────────── */
/* Backdrops for orchestrator mode, hero night-variant, publish/export covers.
   Never used as component fills inside the paper canvas. */
--deep-petrol:    #0d2f33;   /* orchestrator-mode backdrop */
--deep-evergreen: #0f3527;   /* readiness/“locked” celebratory moments */
--deep-plum:      #241b3d;   /* agent-chat sheet backdrop (dark) */
--deep-ink:       #0e0f0c;   /* existing dark base, promoted to token */

/* ── Functional highlights (existing, roles codified) ──── */
--accent-line:   #00b900;    /* brand + confirm/commit actions ONLY */
--accent-cool:   #1fb6c9;    /* links, focus, finance */
--accent-warm:   #ff5d5d;    /* destructive + human-urgency only */
--accent-violet: #7c5cff;    /* reserved → AI provenance (below) */

/* ── AI provenance — the machine hue (NEW roles) ───────── */
--ai-authored:      var(--accent-violet);
--ai-authored-soft: rgb(124 92 255 / 0.12);
--ai-glass-tint:    rgb(124 92 255 / 0.06);
/* Rule: violet appears ONLY on machine-authored/ -proposed elements.
   Human content never wears violet; AI content never wears brand green
   until a human confirms it. The palette itself encodes authorship. */

/* ── Status (existing) + accessible text variants (NEW) ── */
--status-needs-decision: #e08c00;  --status-needs-decision-text: #8a5600;
--status-blocked:        #e23b2e;  --status-blocked-text:        #b3261a;
--status-settled:        #12a05a;  --status-settled-text:        #0d7a44;
/* Base hues = fills/bars/dots (≥3:1 non-text). -text variants = the only
   versions allowed as text on light surfaces (≥4.5:1). */

/* ── On-accent rule (NEW) ──────────────────────────────── */
--on-accent: var(--text-primary);
/* #00b900 + white text = 2.6:1 (fails). Ink on brand green = 7.0:1 (AA).
   Text on saturated accent fills is ALWAYS ink, never white, in light mode. */
```

**Dark mode** (existing inversion, retained): base `#0e0f0c`, raised `#16170f`, brand green brightened to `#2bd24a` (9.5:1 on base — AAA), status hues re-saturated. The deep-field tokens become *less* special in dark mode by design — dark mode is where the retro-futurist register lives natively; light mode borrows it only for depth moments.

Gradients (existing `--gradient-brand`, `--gradient-warm`, `--gradient-cool`, `--gradient-aurora`): demoted to **hero imagery and the `gradient` button variant for trip-level commits only** (publish, lock itinerary). Never on cards, chips, or text.

### 4.3 Spatial & shape tokens (existing, contract restated)

```css
--radius-sm: 0.5rem;  --radius-md: 0.75rem;  --radius-lg: 1rem;
--radius-xl: 1.25rem; --radius-tile: 1.5rem; --radius-pill: 999px;
/* Spacing: 8-pt scale (4 only for icon-text gaps). Tile padding 20px.
   Intra-cluster gap 12px; inter-cluster 24px (§1.1). */
--shadow-flat / --shadow-raise / --shadow-deep / --shadow-tactile  /* existing */
```

### 4.4 Materiality tokens — the glass ladder (NEW)

```css
/* Tier 0 — paper (default): no blur. --surface-raised + --shadow-raise. */

/* Tier 1 — chrome glass: sidebar, rail, sticky header, mobile tab bar */
--glass-1-bg: rgb(255 252 245 / 0.72);  --glass-1-blur: 12px;  --glass-1-sat: 1.4;

/* Tier 2 — object glass: ghost cards, command palette, chat sheet, toasts */
--glass-2-bg: rgb(255 252 245 / 0.60);  --glass-2-blur: 24px;  --glass-2-sat: 1.6;

/* Tier 3 — field glass: modal scrims, orchestrator-mode backdrop */
--glass-3-bg: rgb(255 252 245 / 0.45);  --glass-3-blur: 40px;  --glass-3-sat: 1.5;
--glass-3-grain: url("data:image/svg+xml,…feTurbulence…") /* 2% opacity, tier 3 only */

/* Shared material details */
--glass-edge:   inset 0 1px 0 rgb(255 255 255 / 0.35);   /* specular top */
--glass-stroke: 1px solid rgb(20 19 15 / 0.06);
/* Dark mode: bg bases swap to rgb(22 23 15 / α), edge drops to 0.12 */

/* Adaptive tint (per §3.4): color-mix(in oklab, <tier-bg> 88%, var(--tile-dominant) 12%) */
```

Budget rules: ≤ 3 blurred layers composited simultaneously; blur never nests inside blur; tier 3 appears once per screen at most.

### 4.5 Motion tokens

```css
/* Existing */ --spring-snappy; --spring-gentle; --ease-confirm: cubic-bezier(0.32,0.72,0,1);
--duration-confirm: 220ms; --duration-morph: 380ms; --duration-glow: 1200ms;
/* NEW */
--duration-micro: 140ms;                    /* hover, press, field-claim */
--ease-exit: cubic-bezier(0.4, 0, 1, 1);    /* dismissals — fast out, no bounce */
--focus-ring: 0 0 0 2px var(--surface-base), 0 0 0 4px var(--accent-cool);
```

---

## 5. Accessibility & Fallbacks

### 5.1 Contrast budget (computed, light mode)

| Pairing | Ratio | Verdict / rule |
|---|---|---|
| `--text-primary` #14130f on `--surface-base` #fbfaf6 | 17.8:1 | AAA — default reading |
| `--text-secondary` #3a382f on base | 11.3:1 | AAA — rationales, secondary copy |
| `--text-muted` #6e6a5f on base | 5.2:1 | AA — labels/captions only; **never below 0.8125rem** |
| Ink on `--accent-line` #00b900 | 7.0:1 | AA — the only legal text on brand green; white is banned (2.6:1) |
| `--status-needs-decision-text` #8a5600 on base | 5.6:1 | AA — status-as-text always uses `-text` variants |
| Dark: `#2bd24a` on `#0e0f0c` | 9.5:1 | AAA |
| Text on glass tiers | — | Measured against worst-case composite; tier-2/3 surfaces auto-add a `--surface-raised` 40% underlay behind text blocks when the sampled backdrop fails 4.5:1 |

Non-color redundancy: stage (`todo/pending/confirmed`), run status, and autonomy level are always **icon + label + hue** — never hue alone. The glass/paper material distinction is likewise tripled: translucency + violet provenance dot + "Proposed" label.

### 5.2 High-distraction environments ("Glance mode")

Travelers use this app in airports, on trains, mid-argument about dinner. A dedicated degraded-attention preset:

- **Triggers:** manual toggle in the sticky header; auto-suggested on mobile during `trips.start_date…end_date` (the Ops phase).
- **Changes:** Decide band collapses to the **top-3 Action Queue only**, one item per viewport-third; type scale steps up one notch; AAA contrast enforced (muted text promoted to secondary); all motion reduced to fades; Ambient band behind one tap; touch targets enlarge to 48×48 (44×44 is the global floor).
- **One-handed reach:** primary actions dock to the bottom thumb zone (the mobile Action Queue pill, §3.1); confirm/dismiss on ghost cards become full-width stacked buttons — no precision taps in motion.

### 5.3 Material & motion fallback ladders

| Condition | Behavior |
|---|---|
| `@supports not (backdrop-filter: blur(1px))` | All glass tiers → `--surface-raised` at 96% opacity + `--shadow-raise`. Hierarchy survives via shadow + stroke; semantics survive via provenance markers (which is why authorship is never encoded by translucency alone) |
| `prefers-reduced-transparency` | Same collapse to tier 0, including chrome |
| `prefers-reduced-motion` | Springs → 120ms opacity fades; morphs → crossfade-in-place; count-ups render final value instantly; ProposalCard3D tilt/glare off; run-pulse → static "running…" label; undo countdown → static "10s" text updating per second |
| Low-end GPU (frame budget misses > 4 in 10s, via `requestAnimationFrame` watchdog) | Runtime demotion one glass tier; adaptive tint (`color-mix`) disabled first — degrade the garnish before the structure |
| Data-saver / slow network | Social-photos tile loads on tap; map tile renders static snapshot until interaction |

### 5.4 AI compute fallbacks (the latency ladder, normative)

1. **0–100ms:** optimistic shell renders instantly from cache (`custom_grids.last_output`, cached trip payload in `trip-overview-bento.tsx`). The workspace is *never* gated on a model.
2. **100ms–4s:** skeleton shimmer, **one cycle maximum** — after one pass, the shimmer freezes to a calm placeholder (perpetual shimmer reads as anxiety).
3. **> 4s:** cached content + "as of {time}" stale badge; the fresh run continues in background and cross-fades in on arrival (220ms) with the timestamp resetting.
4. **Failure:** tile keeps last good data; quiet retry affordance; `last_error` in provenance popover. Empty-state only if there has *never* been data.
5. **Outage** (circuit breaker open): one global "AI paused — your trip is unaffected" pill; all violet affordances enter dormant state; zero impact on CRUD/votes/expenses.

### 5.5 Structural accessibility

- **Keyboard:** roving-tabindex grid traversal across bento tiles (arrow keys), Enter to enter a tile, Esc to exit to grid level; ⌘K command palette (existing `command-palette.tsx`) is the universal escape hatch; ghost-card actions reachable in tab order with visible `--focus-ring` (visible on glass — ring offsets from `--surface-base`, not from the glass itself).
- **Screen readers:** ghost lane = `role="feed"` with `aria-live="polite"` (arrivals announced as "Suggestion from Itinerary Drafter: …, 78% confidence"); provenance via `aria-describedby`; AutonomyChip is a `button` with `aria-label` stating current state *and* what the next press does; mode morph announces "Orchestrator view, 4 pending actions"; numeric count-ups expose final value immediately to AT.
- **i18n:** EN/ZH_TW in lockstep (non-negotiable per project docs discipline); CJK type rules per §4.1; dates/currency locale-formatted via the data type token (tabular mono prevents layout shift between locales).

---

## 6. Implementation Map

| Where | What |
|---|---|
| `app/globals.css` | All new tokens (§4): `--font-editorial`, deep field, AI provenance roles, status `-text` variants, glass ladder, motion additions. Honors the no-custom-CSS-files rule — tokens + `@utility` blocks only |
| `app/layout.tsx` | Fraunces + Noto Serif TC via `next/font/google` |
| `components/app/grids/ghost-lane.tsx`, `trip-ai-updates.tsx` | GhostCard anatomy (§3.5.1), 3-visible cap, digest batching (edge case #5) |
| `components/app/grids/custom-grid.tsx`, `trip-orchestrator-mode.tsx` | AutonomyChip per orchestrator tool (§3.5.2); run-now pulse; stale badges |
| `components/app/trip-workspace.tsx`, `trip-bento-page.tsx` | Band taxonomy, anchor-focus behavior, mode morph, delta strip (new component under hero) |
| `components/app/grids/provenance.tsx` | Fixed popover schema (§3.5.5) with pause/autonomy footer actions |
| `lib/docs/copy.ts` | User-guide + SAD updates (EN + ZH_TW) in the same PRs as the UI changes |

**Phasing:** P0 — token layer + fallback ladders + contrast fixes (status text variants, on-accent rule). P1 — ghost-lane consolidation, provenance everywhere, autonomy dial in orchestrator mode, delta strip. P2 — mode morph, Glance mode, adaptive tinting.

**Definition of done per phase:** `npm run build`, `npm run lint`, `npm test` clean; AA verified on every new pairing; `prefers-reduced-motion` and no-`backdrop-filter` paths manually exercised; EN/ZH_TW copy in lockstep.

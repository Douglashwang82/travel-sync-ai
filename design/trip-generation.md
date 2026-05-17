# Trip Generation

Status: Design — scaffolding landed, logic TBD
Branch: `claude/trip-generation-design-VgsMF`

Two entry points let a group (or a solo user on the web) answer a short
"must-have" survey and get a draft trip template back. The user then
forks the draft into a real trip whose `trip_items` populate the bento
workspace.

## Goals

- Lower the cold-start cost from `/start` → empty bento.
- Reuse the existing `trip_templates` / `forkTemplate` pipeline rather
  than introducing a parallel "draft trip" concept.
- One generator service, two surfaces (LINE and web).

## Non-goals

- Booking. The generator produces `stage='todo'` stubs only.
- Replacing the existing `/start` quick-create. Survey lives at `/plan`.
- Real-time collaborative editing of the survey. First-tap-wins in
  groups; the web wizard is single-user.

## Surfaces

```
                                ┌──────────────────────────┐
LINE  /plan ──┐                 │ services/trip-generation │
              │  answers  ────► │   survey.ts (state)      │
Web   /app/trips/new ──┐        │   generator.ts (Gemini)  │
                       │        └────────────┬─────────────┘
                       │                     │
                       │                     ▼
                       │       trip_template_versions (private)
                       │       + trip_template_items
                       │                     │
                       │  user confirms ─────▼
                       └──► services/templates#forkTemplate
                                             │
                                             ▼
                                trips + trip_items
                                             │
                                             ▼
                                bento workspace (existing grids)
```

## Survey

Eight questions. Anyone in the group can tap; the first valid answer
per question locks the slot.

| # | Key | Type | Notes |
|---|------|------|------|
| 1 | `destination` | text or "decide later" | If skipped, seeds an `/idea destination` item post-fork. |
| 2 | `duration_days` | int (calendar on web, quick replies in LINE: 2/3/5/7/10/14) | Drives `trip_template_versions.duration_days`. |
| 3 | `party` | enum: solo / couple / family / friends | Combined with `party_size`. |
| 4 | `party_size` | int 1–20 | |
| 5 | `budget_tier` | enum: shoestring / mid / luxury | |
| 6 | `vibe` | multi-select: relaxed, adventure, culture, foodie, nightlife, nature | Up to 3. |
| 7 | `pace` | enum: chill (≤3 stops/day) / balanced / packed | |
| 8 | `must_haves` | free text | Open-ended; in LINE this drops to a 1:1 DM follow-up with a "skip" button. |

Dealbreakers (allergies, mobility, no-flying) are intentionally cut from
v1 — they belong on a profile, not a per-trip survey.

## Data model

### New table — `trip_survey_sessions`

Lives in `supabase/migrations/20260517000000_trip_survey_sessions.sql`.

```
id                  uuid PK
group_id            uuid FK line_groups (nullable for web sessions)
app_user_id         uuid FK app_users (nullable for LINE sessions)
started_by_user_id  text (line_user_id)
status              enum: in_progress | generated | forked | abandoned | expired
current_step        text (one of the question keys above, or "done")
answers             jsonb (partial map of key → value)
template_id         uuid FK trip_templates (set after generation)
created_at          timestamptz
updated_at          timestamptz
expires_at          timestamptz  -- abandoned after 30 min idle
```

Indexes: `(group_id) where status='in_progress'` (one open survey per
group at a time), `(app_user_id)`, `(expires_at) where status='in_progress'`
for the abandonment sweeper.

Constraint: exactly one of `group_id` or `app_user_id` must be set.

### Reused

- `trip_templates` + `trip_template_versions` + `trip_template_items` —
  generator writes a private (`visibility='private'`) template owned by
  the surveyor. Fork goes through the existing `forkTemplate()`.
- `trips` + `trip_items` — output of the fork; bento renders as today.
- `direct_chat_messages` — only used for the free-text `must_haves`
  follow-up in LINE; nothing else.

## LINE flow (`/plan`)

1. `/plan` in a group → if an active survey exists, replies with a "resume"
   bubble. Otherwise creates a `trip_survey_sessions` row and pushes the
   first Flex bubble.
2. Each question is a Flex bubble with quick-reply buttons whose
   postback data is `survey|<sessionId>|<questionKey>|<value>`.
3. Postback handler (new branch in `services/event-processor.ts`):
   - Loads the session, validates `current_step === questionKey`
     (idempotent; ignores duplicate taps).
   - Writes the answer into `answers`, advances `current_step`, pushes
     the next bubble.
4. Question 8 (`must_haves`) sends a DM to the tapper with a "skip"
   button. The user can free-text or skip. Resumes in the group when
   answered.
5. On completion: calls `generateTemplateFromSurvey(session)`, pushes a
   preview Flex carousel (template summary + "Use this template" button
   → postback `survey|<sessionId>|fork`).
6. Fork postback → calls `forkTemplate()` → pushes a deep link to
   `/app/trips/[tripId]`.

State invariants:
- One `in_progress` session per `group_id` (partial unique index).
- 30-minute idle expiry; the existing `process-events` cron's recovery
  sweeper gets a sibling sweep, or we run a tiny cleanup on each
  `/plan` start.
- All survey postbacks are no-ops if the session is `expired`,
  `forked`, or `abandoned`.

## Web flow (`/app/trips/new`)

Full-page wizard, one question per screen, single column, large
typography. shadcn primitives (`Card`, `RadioGroup`, `Button`, `Input`)
on Tailwind. Progress: 8 dots top-center.

- Step 1 (destination) shows a hero image. Source: existing
  `enrichTripDestinationMetadata()` already pulls a cover image —
  reuse it once the user types and pauses. Fallback: a generic travel
  hero from `public/images/`.
- Multi-select vibe step uses pill toggles, max 3 selected.
- Submit on step 8 → POSTs answers to `app/api/app/trips/generate` →
  the route calls the same `generateTemplateFromSurvey()` →
  immediately calls `forkTemplate()` (no preview step on web; the
  bento workspace IS the preview) → `redirect('/app/trips/[tripId]')`.

The wizard does not persist a `trip_survey_sessions` row per step —
state stays client-side until submit. (We can promote to server-side
draft state later if drop-off matters; not v1.)

## Generator

`services/trip-generation/generator.ts` exports
`generateTemplateFromSurvey(answers, authorLineUserId)`. It:

1. Builds a structured prompt from the answers (no chat history).
2. Calls `generateJson()` from `lib/gemini.ts` with a Zod schema:
   ```
   {
     title: string,
     destination_name: string,
     summary: string,
     tags: string[],
     days: Array<{
       day_number: number,
       items: Array<{
         item_type: 'hotel'|'restaurant'|'activity'|'transport'|'other',
         title: string,
         notes?: string,
         place_name?: string,
         duration_minutes?: number,
       }>
     }>
   }
   ```
3. Inserts a `trip_templates` row (`visibility='private'`,
   `author_line_user_id = surveyor`), a `trip_template_versions` row
   with `version_number=1`, and flattens `days[].items` into
   `trip_template_items`.
4. Returns `{ templateId, versionId }` to the caller.

Pace × budget × vibe shape the prompt's instructions for items-per-day
and price guidance. Destination + duration are mandatory inputs.

## Postback scheme

New prefix: `survey|...`

| Form | Meaning |
|---|---|
| `survey\|<sessionId>\|<questionKey>\|<value>` | Answer for a quick-reply question. |
| `survey\|<sessionId>\|skip_must_haves` | Skip the free-text step. |
| `survey\|<sessionId>\|fork` | Fork the generated draft into a real trip. |
| `survey\|<sessionId>\|cancel` | Abandon the in-progress session. |

Postback length cap (LINE: 300 bytes) is comfortably under for all
above — quick-reply values are short enums.

## Catalog entry

`/plan` is added to `lib/command-catalog.ts` under `category: 'trip'`,
visible in `/help`. The catalog entry will read:

> 用問答方式產生旅程草稿 — 回答幾個必選題，AI 會生成一份私人範本，
> 確認後就會展開到旅程看板。

## Open questions

- **Resume vs restart**: if a group runs `/plan` while another survey
  is in progress, do we resume from the current step or offer
  cancel+restart? v1 = resume; restart requires explicit
  `survey|...|cancel` tap.
- **Anonymous web sessions**: the wizard requires sign-in (so we have
  an `app_user_id` to author the template). Acceptable for v1; the
  marketing page can CTA to sign-in.
- **Preview on web**: do we ever want a "review the draft before
  committing" step on the web? Cut from v1 — answer says the bento IS
  the preview, and items are mutable.
- **Image sourcing for the wizard hero**: relying on
  `enrichTripDestinationMetadata` introduces a latency budget on
  step 1. If too slow, fall back to a curated set of public-domain
  destination images keyed by country.

## Test plan (when we implement)

- Unit: `survey.ts` step transitions; idempotent postback handling;
  expiration logic.
- Unit: `generator.ts` with a mocked `generateJson` — schema validation,
  template/version/items insert shape.
- Integration: `/plan` end-to-end (group survey → fork → trip_items
  visible to bento query) against a Supabase test DB.
- Manual: web wizard golden path on mobile viewport (typography +
  hero image), keyboard navigation, screen reader labels.

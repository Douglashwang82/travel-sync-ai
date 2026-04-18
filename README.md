# TravelSync AI

A collaborative group-trip planning bot for LINE. It reads your group chat, turns scattered conversations into an organised trip board, runs consensus voting, splits expenses, and keeps everyone in sync — all without leaving LINE.

**Live in LINE** → group chat + embedded LIFF web app.

---

## Features

- **AI message parsing** — Gemini 2.0 Flash extracts destinations, dates, preferences automatically
- **Slash commands** — `/start`, `/vote`, `/exp`, `/status`, `/ready`, `/ops`, `/incident`, and 15 more
- **Group voting** — Flex Message carousels with Google Places enrichment; majority auto-confirms
- **Expense splitting** — optimal settlement (minimum transfers) with per-trip summaries
- **Travel tracking** — monitor websites/RSS feeds, get AI-digested updates
- **LIFF web app** — Dashboard, Itinerary, Votes, Expenses, Operations, Readiness, Help tabs

---

## Local development

### Prerequisites

- Node.js 20+
- A Supabase project (free tier works)
- A LINE Messaging API channel + LIFF app
- A Google Gemini API key

### Setup

```bash
git clone https://github.com/Douglashwang82/travel-sync-ai.git
cd travel-sync-ai
npm install
cp .env.example .env.local
# Fill in the values in .env.local (see Environment variables below)
npm run dev
```

The app runs on `http://localhost:3000`.

For LINE webhooks in local dev, expose port 3000 with [ngrok](https://ngrok.com):

```bash
ngrok http 3000
# Set https://<your-ngrok-subdomain>.ngrok.io/api/line/webhook as the LINE webhook URL
```

### Database

Apply migrations to your Supabase project:

```bash
npx supabase db push
# or apply each file in supabase/migrations/ in order via the Supabase SQL editor
```

---

## Commands

```
npm run dev          # Start dev server (Next.js)
npm run build        # Production build
npm run lint         # ESLint
npm run typecheck    # TypeScript check
npm test             # Vitest unit + integration tests
npm run test:e2e     # Playwright E2E tests
```

---

## Environment variables

Copy `.env.example` → `.env.local` and fill in:

| Variable | Required | Description |
|---|---|---|
| `LINE_CHANNEL_SECRET` | Yes | LINE Messaging API channel secret |
| `LINE_CHANNEL_ACCESS_TOKEN` | Yes | LINE channel access token |
| `NEXT_PUBLIC_LIFF_ID` | Yes | LIFF app ID |
| `LIFF_CHANNEL_ID` | Yes | LINE channel ID for LIFF token verification |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Yes | Supabase anon key (browser-safe) |
| `SUPABASE_SECRET_KEY` | Yes | Supabase service-role key (server-only) |
| `GEMINI_API_KEY` | Yes | Google Gemini API key |
| `GOOGLE_PLACES_API_KEY` | No | Enables Places enrichment in voting |
| `CRON_SECRET` | Yes (prod) | Bearer token for Vercel cron authentication |
| `SENTRY_DSN` | No | Sentry DSN for error monitoring |

---

## Deployment (Vercel)

1. Fork/push this repo to GitHub.
2. Import project in [Vercel](https://vercel.com).
3. Set all environment variables in **Settings → Environment Variables**.
4. Deploy — Vercel detects Next.js automatically.
5. Set the Vercel deployment URL as the LINE webhook:  
   `https://your-app.vercel.app/api/line/webhook`
6. Register the LIFF endpoint:  
   `https://your-app.vercel.app/liff`

Cron jobs (defined in `vercel.json`) run automatically on Vercel's infrastructure. `CRON_SECRET` must be set for them to authenticate.

### Health check

```
GET /api/health
```

Returns `{"status":"ok","checks":{"db":"ok","line":"ok","gemini":"ok"}}` when all dependencies are reachable.

---

## Architecture

```
LINE group chat
    │  webhook (POST /api/line/webhook)
    ▼
Next.js API routes (Vercel serverless)
    │
    ├── services/event-processor.ts  ← async event handler
    ├── services/parsing/            ← Gemini NLP pipeline
    ├── services/vote/               ← voting + majority detection
    ├── services/expenses/           ← expense splitting + settlement
    ├── services/decisions/          ← vote options + Google Places
    └── services/incidents/          ← disruption playbooks
    │
    ├── Supabase (PostgreSQL + RLS)  ← persistent state
    └── Google Gemini 2.0 Flash      ← AI (circuit-breaker protected)

LIFF web app (/liff/*)
    └── authenticated via LINE ID token → LIFF API routes
```

---

## Contributing

See `docs/PUBLISH_READINESS.md` for the current launch-hardening roadmap.  
See `docs/runbook.md` for operational procedures.

# Deployment Runbook — Travel Sync AI

**Stack:** Next.js 16 · Supabase · Vercel · LINE Bot + LIFF · Gemini 2.0-flash  
**Target:** Stage 1 — up to 100 users

---

## 1. Prerequisites

| Tool | Purpose | Install |
|------|---------|---------|
| Node.js 20+ | Local development | `nvm install 20` |
| Supabase CLI | Database migrations | `npm i -g supabase` |
| Vercel CLI | Deploy & env vars | `npm i -g vercel` |
| LINE Developer Console | Webhook & LIFF config | [developers.line.biz](https://developers.line.biz) |
| Google Cloud Console | Gemini & Places keys | [console.cloud.google.com](https://console.cloud.google.com) |

---

## 2. First-Time Setup

### 2a. Supabase — Production Database

1. Create a new project at [supabase.com](https://supabase.com). Choose a region close to your users (e.g. `ap-southeast-1` for SEA).
2. Run all migrations in order:
   ```bash
   # From repo root — apply to production database
   supabase db push --db-url "postgresql://postgres:<password>@<host>:5432/postgres"
   ```
   Or run each file in `supabase/migrations/` manually via the Supabase SQL editor in order of filename timestamp.
3. Confirm all tables exist: `line_groups`, `trips`, `trip_items`, `votes`, `outbound_messages`, `rate_limit_windows`, etc.
4. **Upgrade to Supabase Pro** ($25/month) for daily backups and guaranteed uptime. Free tier pauses after 1 week of inactivity.

### 2b. LINE — Messaging API Channel

1. Create a Messaging API channel in LINE Developer Console.
2. Set webhook URL: `https://your-domain.vercel.app/api/line/webhook`
3. Enable webhooks, disable auto-reply and greeting messages.
4. Note your **Channel Secret** and **Channel Access Token**.
5. Run the Rich Menu setup once after deployment:
   ```bash
   npm run setup:rich-menu
   ```

### 2c. LINE — LIFF App

1. In the same channel (or a new Login channel), create a LIFF app.
2. Set the endpoint URL to: `https://your-domain.vercel.app/liff`
3. Set scope: `profile openid`
4. Note the **LIFF ID**.

### 2d. Google Cloud

1. Enable **Gemini API** and **Places API (New)** in Google Cloud Console.
2. Create two API keys with appropriate restrictions (HTTP referrer / IP restrictions).
3. For Gemini: set a monthly billing budget alert at $20.

### 2e. Sentry (optional but recommended)

1. Create a project at [sentry.io](https://sentry.io) (free tier: 5K errors/month).
2. Select **Next.js** as the platform.
3. Copy the **DSN** and create a **Auth Token** with `project:releases` and `org:read` scopes.

---

## 3. Environment Variables

Copy `.env.example` to `.env.local` for local development, or set in Vercel dashboard for production.

**Setting variables on Vercel:**
```bash
vercel env add LINE_CHANNEL_SECRET production
vercel env add LINE_CHANNEL_ACCESS_TOKEN production
vercel env add NEXT_PUBLIC_SUPABASE_URL production
vercel env add NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY production
vercel env add SUPABASE_SECRET_KEY production
vercel env add GEMINI_API_KEY production
vercel env add GOOGLE_PLACES_API_KEY production
vercel env add NEXT_PUBLIC_LIFF_ID production
vercel env add LIFF_CHANNEL_ID production
vercel env add CRON_SECRET production
vercel env add SENTRY_DSN production
vercel env add NEXT_PUBLIC_SENTRY_DSN production
vercel env add SENTRY_AUTH_TOKEN production
vercel env add SENTRY_ORG production
vercel env add SENTRY_PROJECT production
```

> **Security:** Never commit `.env.local` or any file containing real secrets. The `.gitignore` already excludes `.env*` files.

---

## 4. Deploying

### Initial deploy
```bash
# Connect repo to Vercel
vercel link

# Deploy to production
vercel --prod
```

### Subsequent deployments (CI/CD recommended)
Push to the `main` branch — Vercel automatically deploys on every push if GitHub integration is enabled.

### Verify deployment
```bash
# Check all env vars are present
vercel env ls

# Trigger a webhook health check (should return {"ok":true})
curl -X POST https://your-domain.vercel.app/api/line/webhook \
  -H "Content-Type: application/json" \
  -H "X-Line-Signature: invalid" \
  -d '{"destination":"test","events":[]}'
# Expected: {"error":"Invalid signature","code":"INVALID_SIGNATURE"}
```

---

## 5. Cron Jobs

Cron schedules are defined in `vercel.json`. They require the **Vercel Pro** plan.

| Route | Schedule | Purpose |
|-------|----------|---------|
| `/api/cron/process-events` | `0 * * * *` (hourly) | Retry stuck events, retry failed outbound messages |
| `/api/cron/vote-deadlines` | `0 1 * * *` | Close overdue votes, announce winners |
| `/api/cron/stale-reminders` | `0 2 * * *` | Remind groups with untouched todo items |
| `/api/cron/cleanup` | `0 3 * * *` | Purge expired messages, events, rate limit windows |
| `/api/cron/daily-digest` | `0 9 * * *` | Daily summary to active groups |

**Testing a cron manually:**
```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://your-domain.vercel.app/api/cron/cleanup
```

---

## 6. Rollback Procedure

### Application rollback
```bash
# List recent deployments
vercel ls

# Promote a previous deployment to production
vercel promote <deployment-url>
```

### Database rollback
Supabase does not support automatic schema rollback. For each migration, write a compensating SQL script if you need to undo it. The safest approach:

1. Before any schema-changing migration, take a manual snapshot:  
   Supabase Dashboard → Database → Backups → Create backup
2. If rollback is needed: restore from that snapshot in the Supabase dashboard.

---

## 7. Incident Response

### Bot not responding to messages

1. Check Vercel function logs: Vercel Dashboard → Deployments → Functions → `/api/line/webhook`
2. Check LINE Developer Console → Webhook → Recent deliveries for delivery failures
3. Check Sentry for unhandled exceptions
4. Verify `LINE_CHANNEL_SECRET` and `LINE_CHANNEL_ACCESS_TOKEN` are set correctly
5. If `processing_status = 'pending'` rows are piling up in `line_events`, the cron is not running — check Vercel cron logs

### Messages not being parsed / entities missing

1. Check Sentry for `[gemini]` errors
2. Check if the Gemini circuit breaker is open (look for `[gemini] Circuit OPEN` in logs)
3. Test Gemini API key manually:
   ```bash
   curl "https://generativelanguage.googleapis.com/v1beta/models?key=$GEMINI_API_KEY"
   ```
4. Check Google Cloud Console for quota exhaustion

### Push messages failing

1. Check `outbound_messages` table for rows with `status = 'failed'`
2. Check `failure_reason` column for error details
3. Verify `LINE_CHANNEL_ACCESS_TOKEN` has not expired (they don't expire unless revoked)
4. Check LINE API status at [linedevstatus.com](https://linedevstatus.com)

### Database issues

1. Check Supabase Dashboard → Database → Health for connection pool exhaustion
2. Check for long-running queries: Supabase → Database → Query Performance
3. If the DB is paused (free tier): upgrade to Pro or restore from backup

---

## 8. Cost Monitoring

Set up billing alerts for each service:

| Service | Alert at | Notes |
|---------|----------|-------|
| Google Cloud (Gemini + Places) | $20/month | AI Studio → Billing |
| Vercel | Check usage tab | Pro plan is flat $20 |
| Supabase | Check usage tab | Pro plan is flat $25 |
| LINE API | Check in LINE console | Pay-as-you-go after 500 free msgs |

---

## 9. Security Checklist (run after each major deploy)

- [ ] `CRON_SECRET` is set and strong (32+ random bytes)
- [ ] `SUPABASE_SECRET_KEY` is not exposed in client-side code (`NEXT_PUBLIC_` prefix is absent)
- [ ] LINE webhook signature verification is working (test with invalid sig → expect 401)
- [ ] Supabase RLS is enabled on all tables (Supabase → Table Editor → each table → RLS)
- [ ] No secrets in git history: `git log --all --full-history -- .env*`
- [ ] Google API keys have HTTP referrer or IP restrictions set
- [ ] Sentry is receiving errors (trigger a test error via Sentry dashboard)

---

## 10. Useful Commands

```bash
# Run unit tests
npm test

# Run E2E tests
npm run test:e2e

# Check TypeScript
npx tsc --noEmit

# View production logs (requires Vercel CLI)
vercel logs --prod

# Apply a new migration to production
supabase db push --db-url "$DATABASE_URL"

# Manually trigger a rich menu setup
npm run setup:rich-menu
```

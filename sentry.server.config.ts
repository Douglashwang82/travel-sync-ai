// Server-side Sentry configuration (API routes, cron jobs, background processing).
// Uses @sentry/node, no Next.js peer dependency required.
// Imported by instrumentation.ts on server startup only when SENTRY_DSN is set.
//
// NOTE: @sentry/nextjs requires Next.js <=15. Once Sentry officially adds
// Next.js 16 support, swap this back to @sentry/nextjs for full coverage.

import * as Sentry from "@sentry/node";

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,

    // Capture 10% of transactions for performance monitoring in production.
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,

    enabled: true,
    environment: process.env.NODE_ENV ?? "development",

    // Ignore expected, non-actionable errors.
    ignoreErrors: [
      "INVALID_SIGNATURE", // LINE webhook auth failures from bots/scanners.
      "INVALID_JSON",
    ],

    beforeSend(event) {
      // Strip LINE user/group IDs from breadcrumbs to reduce PII in Sentry.
      if (Array.isArray(event.breadcrumbs)) {
        for (const crumb of event.breadcrumbs) {
          if (crumb.message) {
            crumb.message = crumb.message.replace(/U[a-f0-9]{32}/g, "[LINE_USER]");
            crumb.message = crumb.message.replace(/C[a-f0-9]{32}/g, "[LINE_GROUP]");
          }
        }
      }
      return event;
    },
  });
}

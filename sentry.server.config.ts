// This file configures the Sentry SDK for the server-side (Next.js API routes,
// Server Components, and Edge Runtime). It is imported by instrumentation.ts.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,

  // Percentage of transactions captured for performance monitoring.
  // Start at 10% and adjust based on volume — for 100 users this is fine at 1.0.
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,

  // Do not send errors in development unless SENTRY_DSN is explicitly set
  enabled: !!process.env.SENTRY_DSN,

  environment: process.env.NODE_ENV ?? "development",

  // Ignore expected/non-actionable errors
  ignoreErrors: [
    "INVALID_SIGNATURE",   // LINE webhook auth failures — expected from bots/scanners
    "INVALID_JSON",
  ],

  beforeSend(event) {
    // Strip LINE user IDs and group IDs from breadcrumbs to reduce PII in Sentry
    if (event.breadcrumbs?.values) {
      for (const crumb of event.breadcrumbs.values) {
        if (crumb.message) {
          crumb.message = crumb.message.replace(/U[a-f0-9]{32}/g, "[LINE_USER]");
          crumb.message = crumb.message.replace(/C[a-f0-9]{32}/g, "[LINE_GROUP]");
        }
      }
    }
    return event;
  },
});

// This file configures the Sentry SDK for the browser (LIFF pages).
// It is auto-imported by Next.js instrumentation on the client side.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,

  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,

  environment: process.env.NODE_ENV ?? "development",

  // LIFF apps run inside LINE — replays can be useful but increase bundle size.
  // Enable only if needed for debugging LIFF-specific issues.
  // integrations: [Sentry.replayIntegration()],
  // replaysSessionSampleRate: 0.01,
  // replaysOnErrorSampleRate: 1.0,
});

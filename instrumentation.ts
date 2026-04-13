// Next.js instrumentation hook — runs once on server startup before any
// requests are handled. Sentry must be initialised here so it captures errors
// from all server-side code including API routes and cron jobs.
// https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
//
// Using @sentry/node (not @sentry/nextjs) because @sentry/nextjs currently
// only supports Next.js ≤15. Functionality is equivalent for server-side
// API route and background job monitoring.

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  // Edge Runtime: @sentry/node is Node.js-only — skip for edge functions.
  // Add @sentry/vercel-edge when/if edge routes need monitoring.
}

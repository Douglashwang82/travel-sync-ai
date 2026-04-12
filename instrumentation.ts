// Next.js instrumentation hook — runs once on server startup.
// Sentry must be initialised here (not inside a component or route) so it
// captures errors from all server-side code including API routes and crons.
// https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.server.config");
  }
}

// Re-export the Sentry onRequestError hook so Next.js passes unhandled
// server errors to Sentry automatically (Next.js 15+ feature).
export { onRequestError } from "@sentry/nextjs/nextjs";

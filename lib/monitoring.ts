/**
 * Thin wrapper around Sentry for explicit error and event capture.
 *
 * Usage:
 *   import { captureError, captureMessage } from "@/lib/monitoring";
 *   captureError(err, { context: "webhook", groupId });
 *
 * Safe to call even if SENTRY_DSN is not configured - all calls are no-ops
 * when Sentry is not initialised.
 */

import { createRequire } from "module";

type SentryModule = typeof import("@sentry/node");

const require = createRequire(import.meta.url);
let sentryModule: SentryModule | null | undefined;

function getSentry(): SentryModule | null {
  if (sentryModule !== undefined) {
    return sentryModule;
  }

  try {
    sentryModule = require("@sentry/node") as SentryModule;
  } catch {
    sentryModule = null;
  }

  return sentryModule;
}

export function captureError(
  err: unknown,
  context?: Record<string, string | number | boolean | undefined>
): void {
  if (!process.env.SENTRY_DSN) {
    console.error("[monitoring]", err, context ?? "");
    return;
  }

  const Sentry = getSentry();
  if (!Sentry) {
    console.error("[monitoring]", err, context ?? "");
    return;
  }

  Sentry.withScope((scope) => {
    if (context) scope.setExtras(context);
    Sentry.captureException(err);
  });
}

export function captureMessage(
  message: string,
  level: "info" | "warning" | "error" = "info",
  context?: Record<string, string | number | boolean | undefined>
): void {
  if (!process.env.SENTRY_DSN) return;

  const Sentry = getSentry();
  if (!Sentry) {
    return;
  }

  Sentry.withScope((scope) => {
    if (context) scope.setExtras(context);
    Sentry.captureMessage(message, level);
  });
}

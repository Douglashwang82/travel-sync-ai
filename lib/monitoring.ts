/**
 * Thin wrapper around Sentry for explicit error and event capture.
 *
 * Usage:
 *   import { captureError, captureMessage } from "@/lib/monitoring";
 *   captureError(err, { context: "webhook", groupId });
 *
 * Safe to call even if SENTRY_DSN is not configured — all calls are no-ops
 * when Sentry is not initialised.
 */

import * as Sentry from "@sentry/nextjs";

export function captureError(
  err: unknown,
  context?: Record<string, string | number | boolean | undefined>
): void {
  if (!process.env.SENTRY_DSN) {
    // Sentry not configured — fall through to console only
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
  Sentry.withScope((scope) => {
    if (context) scope.setExtras(context);
    Sentry.captureMessage(message, level);
  });
}

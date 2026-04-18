import * as Sentry from "@sentry/node";

export interface LogContext {
  traceId?: string;
  groupId?: string;
  tripId?: string;
  userId?: string;
  eventId?: string;
  context?: string;
  processed?: number;
  retriedOutbound?: number;
  [key: string]: string | number | boolean | undefined;
}

type Level = "info" | "warn" | "error";

function emit(level: Level, msg: string, ctx?: LogContext): void {
  const entry = JSON.stringify({
    level,
    msg,
    ts: new Date().toISOString(),
    ...ctx,
  });

  if (level === "error") console.error(entry);
  else if (level === "warn") console.warn(entry);
  else console.log(entry);

  if (process.env.SENTRY_DSN) {
    const sentryLevel = level === "warn" ? "warning" : level;
    Sentry.addBreadcrumb({ level: sentryLevel, message: msg, data: ctx });
  }
}

export const logger = {
  info: (msg: string, ctx?: LogContext) => emit("info", msg, ctx),
  warn: (msg: string, ctx?: LogContext) => emit("warn", msg, ctx),
  error: (msg: string, ctx?: LogContext) => emit("error", msg, ctx),
};

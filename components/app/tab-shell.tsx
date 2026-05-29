"use client";

import type { ReactNode } from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { fadeUp, springPop } from "@/components/motion/variants";

/**
 * Shared "tab page" primitives so every Trip workspace tab (Itinerary,
 * Ideas, Votes, Expenses, Pack, Map, Board, Settings) reads as the same
 * surface family as the Overview bento — `surface-tile` cards, the
 * display heading + caps subtitle pair, and consistent loading / error
 * affordances.
 */

export function TabPageHeader({
  id,
  title,
  subtitle,
  eyebrow,
  actions,
}: {
  id?: string;
  title: string;
  subtitle?: string;
  eyebrow?: string;
  actions?: ReactNode;
}) {
  return (
    <motion.header
      id={id}
      className="flex flex-wrap items-end justify-between gap-3"
      variants={fadeUp}
      initial="hidden"
      animate="show"
    >
      <div className="min-w-0">
        {eyebrow && <p className="text-caps mb-1">{eyebrow}</p>}
        <h2 className="text-display text-2xl text-gradient">{title}</h2>
        {subtitle && (
          <p className="mt-1 text-xs text-[var(--text-muted)]">{subtitle}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </motion.header>
  );
}

export function TabSurface({
  className,
  children,
  as: Tag = "section",
  ...rest
}: {
  className?: string;
  children: ReactNode;
  as?: "section" | "div" | "article" | "form";
} & Omit<React.HTMLAttributes<HTMLElement>, "className" | "children">) {
  return (
    <Tag className={cn("surface-tile p-5", className)} {...rest}>
      {children}
    </Tag>
  );
}

export function TabSurfaceTitle({
  id,
  title,
  subtitle,
  trailing,
}: {
  id?: string;
  title: string;
  subtitle?: string;
  trailing?: ReactNode;
}) {
  return (
    <header id={id} className="flex flex-wrap items-baseline justify-between gap-3">
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h3>
        {subtitle && (
          <p className="mt-0.5 text-xs text-[var(--text-muted)]">{subtitle}</p>
        )}
      </div>
      {trailing && <div className="shrink-0">{trailing}</div>}
    </header>
  );
}

export function TabError({
  message,
  onRetry,
  retryLabel = "Retry",
}: {
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <div className="rounded-[var(--radius-tile)] border border-[var(--status-blocked)] bg-[var(--status-blocked-soft)] px-4 py-4 text-sm text-[var(--status-blocked)]">
      {message}
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="ml-2 underline underline-offset-2"
        >
          {retryLabel}
        </button>
      )}
    </div>
  );
}

export function TabSkeleton({
  height = 256,
  className,
}: {
  height?: number;
  className?: string;
}) {
  return (
    <div
      aria-hidden
      className={cn("skeleton rounded-[var(--radius-tile)]", className)}
      style={{ minHeight: height }}
    />
  );
}

export function TabEmptyState({
  message,
  hint,
  icon,
}: {
  message: string;
  hint?: string;
  icon?: ReactNode;
}) {
  return (
    <motion.div
      className="flex flex-col items-center justify-center gap-2 rounded-[var(--radius-tile)] border border-dashed border-[var(--border-hairline)] bg-[var(--surface-sunken)]/40 px-6 py-10 text-center"
      variants={fadeUp}
      initial="hidden"
      animate="show"
    >
      {icon && (
        <motion.span
          aria-hidden
          variants={springPop}
          initial="hidden"
          animate="show"
          className="chip-gradient inline-flex h-10 w-10 items-center justify-center rounded-full text-[var(--accent-line)]"
        >
          {icon}
        </motion.span>
      )}
      <p className="text-sm text-[var(--text-muted)]">{message}</p>
      {hint && <p className="text-xs text-[var(--text-faint)]">{hint}</p>}
    </motion.div>
  );
}

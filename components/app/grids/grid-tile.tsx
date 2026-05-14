"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Wrapper around an existing feature component to make it a bento grid cell.
 *
 * Most feature components (TripItineraryClient, TripExpensesClient, …) already
 * render their own surface-tile chrome via the tab-shell primitives, so the
 * cell only needs to provide:
 *   - an anchor `id` for scroll-spy nav,
 *   - `data-bento-tile` so j/k keyboard nav can find it,
 *   - scroll-margin so anchor jumps don't sit under the sticky nav.
 */
export function BentoCell({
  id,
  className,
  children,
}: {
  id: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      data-bento-tile
      tabIndex={-1}
      className={cn(
        "scroll-mt-24 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-line)] focus-visible:ring-offset-2 rounded-[var(--radius-tile)]",
        "min-w-0",
        className
      )}
    >
      {children}
    </section>
  );
}

/**
 * Tile shell for grids that don't reuse an existing feature component
 * (e.g. MembersGrid). Renders the standard surface-tile + header + scrollable
 * body that mirrors how `tab-shell.tsx` styles tab pages.
 */
export function GridTile({
  id,
  title,
  eyebrow,
  icon,
  actions,
  footer,
  className,
  bodyClassName,
  children,
}: {
  id?: string;
  title: string;
  eyebrow?: string;
  icon?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      tabIndex={-1}
      data-bento-tile
      className={cn(
        "surface-tile relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-[var(--radius-tile)]",
        "scroll-mt-24 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-line)] focus-visible:ring-offset-2",
        className
      )}
    >
      <header className="flex items-start justify-between gap-3 border-b border-[var(--border-hairline)] px-5 py-3">
        <div className="min-w-0">
          {eyebrow && <p className="text-caps text-[10px]">{eyebrow}</p>}
          <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
            {icon && (
              <span
                aria-hidden
                className="inline-flex h-5 w-5 items-center justify-center text-[var(--accent-line)]"
              >
                {icon}
              </span>
            )}
            <span className="truncate">{title}</span>
          </h3>
        </div>
        {actions && (
          <div className="flex shrink-0 items-center gap-2">{actions}</div>
        )}
      </header>

      <div
        className={cn(
          "flex-1 min-h-0 overflow-y-auto px-5 py-4",
          bodyClassName
        )}
      >
        {children}
      </div>

      {footer && (
        <footer className="border-t border-[var(--border-hairline)] px-5 py-2 text-xs text-[var(--text-muted)]">
          {footer}
        </footer>
      )}
    </section>
  );
}

export function GridTileSkeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "skeleton h-full min-h-[280px] rounded-[var(--radius-tile)]",
        className
      )}
    />
  );
}

export function GridTileError({
  message,
  onRetry,
  retryLabel = "Retry",
}: {
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <div className="flex h-full flex-col items-start justify-center gap-2 rounded-[var(--radius-tile)] border border-[var(--status-blocked)] bg-[var(--status-blocked-soft)] px-5 py-4 text-sm text-[var(--status-blocked)]">
      <span>{message}</span>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="underline underline-offset-2"
        >
          {retryLabel}
        </button>
      )}
    </div>
  );
}

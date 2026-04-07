"use client";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { ReactNode } from "react";

// ─── Skeleton ──────────────────────────────────────────────────────────────

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "animate-pulse bg-[var(--secondary)] rounded-lg",
        className
      )}
    />
  );
}

// ─── Loading screens ───────────────────────────────────────────────────────

/** Spinner + optional message — used while LIFF is initialising / logging in */
export function LoadingSpinner({ message }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] gap-3">
      <div className="w-6 h-6 border-2 border-[var(--primary)] border-t-transparent rounded-full animate-spin" />
      {message && (
        <p className="text-sm text-[var(--muted-foreground)]">{message}</p>
      )}
    </div>
  );
}

/** Kanban-style skeleton — mimics the dashboard board columns */
export function BoardSkeleton() {
  return (
    <div className="max-w-md mx-auto">
      {/* Header */}
      <div className="border-b border-[var(--border)] px-4 py-3">
        <Skeleton className="h-5 w-36" />
        <Skeleton className="h-3 w-24 mt-1.5" />
        <Skeleton className="h-1 w-full rounded-full mt-2" />
      </div>

      <div className="px-4 pt-4 space-y-3">
        {[["w-14", 2], ["w-24", 1], ["w-20", 3]].map(([w, n], colIdx) => (
          <div
            key={colIdx}
            className="rounded-2xl border border-[var(--border)] overflow-hidden"
          >
            {/* Column header */}
            <div className="flex items-center justify-between px-4 py-2.5 bg-[var(--secondary)]">
              <Skeleton className={`h-4 ${w}`} />
              <Skeleton className="h-5 w-6 rounded-full" />
            </div>
            {/* Rows */}
            {Array.from({ length: n as number }).map((_, rowIdx) => (
              <div
                key={rowIdx}
                className="px-4 py-3 flex items-center gap-3 border-t border-[var(--border)] first:border-0"
              >
                <Skeleton className="h-5 w-5 rounded shrink-0" />
                <Skeleton className="h-4 flex-1" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Generic list skeleton — 3 rows of text + meta */
export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="max-w-md mx-auto">
      {/* Header */}
      <div className="border-b border-[var(--border)] px-4 py-3">
        <Skeleton className="h-5 w-28" />
        <Skeleton className="h-3 w-20 mt-1.5" />
      </div>

      <div className="px-4 pt-4 space-y-4">
        {/* Summary card */}
        <Skeleton className="h-24 rounded-2xl" />

        {/* List section */}
        <div>
          <Skeleton className="h-3 w-20 mb-2" />
          <div className="rounded-2xl border border-[var(--border)] divide-y divide-[var(--border)] overflow-hidden">
            {Array.from({ length: rows }).map((_, i) => (
              <div key={i} className="px-4 py-3 flex items-center gap-3">
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
                <Skeleton className="h-4 w-12 shrink-0" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Timeline skeleton — mimics the itinerary page */
export function TimelineSkeleton() {
  return (
    <div className="max-w-md mx-auto">
      <div className="border-b border-[var(--border)] px-4 py-3">
        <Skeleton className="h-5 w-36" />
        <Skeleton className="h-3 w-24 mt-1.5" />
      </div>

      <div className="px-4 pt-4 space-y-5">
        {[2, 1, 2].map((count, groupIdx) => (
          <div key={groupIdx} className="space-y-3">
            {/* Date label */}
            <div className="flex items-center gap-3">
              <div className="h-px flex-1 bg-[var(--border)]" />
              <Skeleton className="h-3 w-20 rounded-full" />
              <div className="h-px flex-1 bg-[var(--border)]" />
            </div>
            {Array.from({ length: count }).map((_, itemIdx) => (
              <div
                key={itemIdx}
                className="rounded-2xl border border-[var(--border)] overflow-hidden"
              >
                {itemIdx === 0 && groupIdx === 0 && (
                  <Skeleton className="w-full h-36" />
                )}
                <div className="p-4 space-y-2">
                  <div className="flex items-start gap-2.5">
                    <Skeleton className="h-6 w-6 shrink-0 rounded" />
                    <div className="flex-1 space-y-1.5">
                      <Skeleton className="h-4 w-2/3" />
                      <Skeleton className="h-3 w-1/2" />
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Error screen ──────────────────────────────────────────────────────────

export function ErrorScreen({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] p-6 text-center gap-4">
      <div className="w-14 h-14 rounded-2xl bg-red-50 dark:bg-red-950 flex items-center justify-center text-2xl">
        ⚠️
      </div>
      <div>
        <p className="font-semibold text-sm">Something went wrong</p>
        <p className="text-sm text-[var(--muted-foreground)] mt-1 max-w-xs leading-relaxed">
          {message}
        </p>
      </div>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

// ─── Empty state ───────────────────────────────────────────────────────────

export function EmptyState({
  emoji,
  title,
  description,
  action,
}: {
  emoji: string;
  title: string;
  description: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] p-6 text-center gap-4">
      <div className="w-16 h-16 rounded-2xl bg-[var(--secondary)] flex items-center justify-center text-3xl select-none">
        {emoji}
      </div>
      <div>
        <p className="font-semibold text-sm">{title}</p>
        <div className="text-sm text-[var(--muted-foreground)] mt-1 max-w-xs leading-relaxed">
          {description}
        </div>
      </div>
      {action}
    </div>
  );
}

// ─── Inline error banner ───────────────────────────────────────────────────

export function InlineError({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss?: () => void;
}) {
  return (
    <div className="mx-4 mt-3 flex items-start gap-2 px-3 py-2.5 rounded-xl bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300">
      <span className="text-sm shrink-0">⚠️</span>
      <p className="text-xs leading-relaxed flex-1">{message}</p>
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="shrink-0 text-red-400 hover:text-red-600 transition-colors"
          aria-label="Dismiss"
        >
          ✕
        </button>
      )}
    </div>
  );
}

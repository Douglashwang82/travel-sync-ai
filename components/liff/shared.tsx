"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-lg bg-[var(--secondary)]",
        className
      )}
    />
  );
}

export function LoadingSpinner({ message }: { message?: string }) {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-3">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--primary)] border-t-transparent" />
      {message ? (
        <p className="text-sm text-[var(--muted-foreground)]">{message}</p>
      ) : null}
    </div>
  );
}

export function BoardSkeleton() {
  return (
    <div className="mx-auto max-w-md">
      <div className="border-b border-[var(--border)] px-4 py-3">
        <Skeleton className="h-5 w-36" />
        <Skeleton className="mt-1.5 h-3 w-24" />
        <Skeleton className="mt-2 h-1 w-full rounded-full" />
      </div>

      <div className="space-y-3 px-4 pt-4">
        {[["w-14", 2], ["w-24", 1], ["w-20", 3]].map(([width, count], colIdx) => (
          <div
            key={colIdx}
            className="overflow-hidden rounded-2xl border border-[var(--border)]"
          >
            <div className="flex items-center justify-between bg-[var(--secondary)] px-4 py-2.5">
              <Skeleton className={`h-4 ${width}`} />
              <Skeleton className="h-5 w-6 rounded-full" />
            </div>
            {Array.from({ length: count as number }).map((_, rowIdx) => (
              <div
                key={rowIdx}
                className="flex items-center gap-3 border-t border-[var(--border)] px-4 py-3 first:border-0"
              >
                <Skeleton className="h-5 w-5 shrink-0 rounded" />
                <Skeleton className="h-4 flex-1" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="mx-auto max-w-md">
      <div className="border-b border-[var(--border)] px-4 py-3">
        <Skeleton className="h-5 w-28" />
        <Skeleton className="mt-1.5 h-3 w-20" />
      </div>

      <div className="space-y-4 px-4 pt-4">
        <Skeleton className="h-24 rounded-2xl" />

        <div>
          <Skeleton className="mb-2 h-3 w-20" />
          <div className="overflow-hidden rounded-2xl border border-[var(--border)] divide-y divide-[var(--border)]">
            {Array.from({ length: rows }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3">
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

export function TimelineSkeleton() {
  return (
    <div className="mx-auto max-w-md">
      <div className="border-b border-[var(--border)] px-4 py-3">
        <Skeleton className="h-5 w-36" />
        <Skeleton className="mt-1.5 h-3 w-24" />
      </div>

      <div className="space-y-5 px-4 pt-4">
        {[2, 1, 2].map((count, groupIdx) => (
          <div key={groupIdx} className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="h-px flex-1 bg-[var(--border)]" />
              <Skeleton className="h-3 w-20 rounded-full" />
              <div className="h-px flex-1 bg-[var(--border)]" />
            </div>
            {Array.from({ length: count }).map((_, itemIdx) => (
              <div
                key={itemIdx}
                className="overflow-hidden rounded-2xl border border-[var(--border)]"
              >
                {itemIdx === 0 && groupIdx === 0 ? (
                  <Skeleton className="h-36 w-full" />
                ) : null}
                <div className="space-y-2 p-4">
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

export function ErrorScreen({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50 text-xl font-semibold text-red-700 dark:bg-red-950 dark:text-red-300">
        !
      </div>
      <div>
        <p className="text-sm font-semibold">Something went wrong</p>
        <p className="mt-1 max-w-xs text-sm leading-relaxed text-[var(--muted-foreground)]">
          {message}
        </p>
      </div>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

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
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="flex h-16 w-16 select-none items-center justify-center rounded-2xl bg-[var(--secondary)] text-3xl">
        {emoji}
      </div>
      <div>
        <p className="text-sm font-semibold">{title}</p>
        <div className="mt-1 max-w-xs text-sm leading-relaxed text-[var(--muted-foreground)]">
          {description}
        </div>
      </div>
      {action}
    </div>
  );
}

export function InlineError({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss?: () => void;
}) {
  return (
    <div className="mx-4 mt-3 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
      <span className="shrink-0 text-sm font-semibold">!</span>
      <p className="flex-1 text-xs leading-relaxed">{message}</p>
      {onDismiss ? (
        <button
          onClick={onDismiss}
          className="shrink-0 text-red-400 transition-colors hover:text-red-600"
          aria-label="Dismiss"
        >
          x
        </button>
      ) : null}
    </div>
  );
}

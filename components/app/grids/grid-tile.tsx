"use client";

import { cn } from "@/lib/utils";

/**
 * Loading skeleton used inside a BentoFrame while a grid fetches its data.
 */
export function GridTileSkeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "skeleton h-full min-h-[200px] w-full rounded-[var(--radius-md)]",
        className
      )}
    />
  );
}

/**
 * Inline error state used inside a BentoFrame when a grid's load fails.
 */
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
    <div className="flex h-full flex-col items-start justify-center gap-2 rounded-[var(--radius-md)] border border-[var(--status-blocked)] bg-[var(--status-blocked-soft)] px-4 py-3 text-sm text-[var(--status-blocked)]">
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

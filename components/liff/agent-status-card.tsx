"use client";

import { cn } from "@/lib/utils";
import type { AgentStatusData } from "@/app/api/liff/agent-status/route";

function formatRelativeTime(isoString: string | null): string {
  if (!isoString) return "never";
  const diffMs = Date.now() - new Date(isoString).getTime();
  if (diffMs < 0) return "just now";
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function AgentStatusCard({ data }: { data: AgentStatusData }) {
  const { lastActiveAt, entitiesToday, itemsCreatedThisWeek, isListening } = data;

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--secondary)] px-4 py-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-[var(--foreground)]">TravelBot</span>
          <span
            className={cn(
              "h-2 w-2 rounded-full",
              isListening ? "bg-green-500" : "bg-[var(--muted-foreground)]"
            )}
          />
          <span className="text-xs text-[var(--muted-foreground)]">
            {isListening ? "Listening" : "Inactive"}
          </span>
        </div>
        <span className="text-xs text-[var(--muted-foreground)]">
          Last active: {formatRelativeTime(lastActiveAt)}
        </span>
      </div>

      {(entitiesToday > 0 || itemsCreatedThisWeek > 0) && (
        <p className="mt-1.5 text-xs text-[var(--muted-foreground)]">
          Today:{" "}
          {entitiesToday > 0 && (
            <span>
              {entitiesToday} note{entitiesToday !== 1 ? "s" : ""} extracted
            </span>
          )}
          {entitiesToday > 0 && itemsCreatedThisWeek > 0 && <span> · </span>}
          {itemsCreatedThisWeek > 0 && (
            <span>
              {itemsCreatedThisWeek} item{itemsCreatedThisWeek !== 1 ? "s" : ""} added this week
            </span>
          )}
        </p>
      )}
    </div>
  );
}

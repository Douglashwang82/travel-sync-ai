"use client";

import { cn } from "@/lib/utils";
import type { DayInfo } from "./use-trip-calendar";

/**
 * One day square inside the month grid. Renders:
 *  - the date number
 *  - a thin holiday bar at the bottom (one color per country, capped at 4)
 *  - small availability dots: green/yellow/grey (free/maybe/busy)
 *  - "today" ring and trip-window dimming
 */
export function DayCell({
  day,
  inCurrentMonth,
  itemCount,
  density,
  onClick,
}: {
  day: DayInfo;
  inCurrentMonth: boolean;
  itemCount: number;
  density: "compact" | "full";
  onClick: () => void;
}) {
  const dayNum = Number(day.date.slice(8, 10));
  const dotCount = day.freeCount + day.maybeCount + day.busyCount;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${day.date}, ${dotCount} availability marks, ${day.holidays.length} holidays`}
      className={cn(
        "group relative flex h-full min-h-[64px] w-full flex-col items-stretch justify-between rounded-[var(--radius-sm)] border p-1 text-left transition-colors",
        "border-[var(--border-hairline)] bg-[var(--surface-raised)]",
        "hover:border-[var(--accent-line)] hover:bg-[var(--surface-sunken)]",
        !inCurrentMonth && "opacity-40",
        !day.isInTripWindow && inCurrentMonth && "opacity-70",
        day.isToday &&
          "border-[var(--accent-line)] ring-1 ring-[var(--accent-line)]"
      )}
    >
      <div className="flex items-start justify-between gap-1">
        <span
          className={cn(
            "text-[11px] font-semibold tabular-nums",
            day.isToday
              ? "text-[var(--accent-line)]"
              : "text-[var(--text-primary)]"
          )}
        >
          {dayNum}
        </span>
        {itemCount > 0 && (
          <span
            aria-label={`${itemCount} itinerary items`}
            className="rounded-full bg-[var(--accent-line-soft)] px-1 text-[9px] font-semibold text-[var(--accent-line)]"
          >
            {itemCount}
          </span>
        )}
      </div>

      {/* Availability dots */}
      {density === "full" && dotCount > 0 && (
        <div className="flex flex-wrap gap-0.5 px-0.5">
          {renderDots(day.freeCount, "#22c55e", "free")}
          {renderDots(day.maybeCount, "#eab308", "maybe")}
          {renderDots(day.busyCount, "#9ca3af", "busy")}
        </div>
      )}
      {density === "compact" && dotCount > 0 && (
        <div className="px-0.5 text-[9px] font-semibold text-[var(--text-muted)]">
          {day.freeCount}
          <span className="opacity-50">/{dotCount}</span>
        </div>
      )}

      {/* Holiday bar */}
      {day.holidays.length > 0 && (
        <div className="flex gap-[2px]" aria-hidden>
          {day.holidays.slice(0, 4).map((h) => (
            <span
              key={`${h.country}-${h.name}`}
              title={`${h.country}: ${h.name}`}
              className="h-1 flex-1 rounded-full"
              style={{ backgroundColor: countryColor(h.country) }}
            />
          ))}
        </div>
      )}
    </button>
  );
}

function renderDots(count: number, color: string, label: string) {
  if (count === 0) return null;
  const capped = Math.min(count, 5);
  const overflow = count - capped;
  return (
    <span className="inline-flex items-center gap-[2px]" aria-label={`${count} ${label}`}>
      {Array.from({ length: capped }).map((_, i) => (
        <span
          key={i}
          className="h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: color }}
        />
      ))}
      {overflow > 0 && (
        <span className="text-[8px] font-semibold text-[var(--text-faint)]">
          +{overflow}
        </span>
      )}
    </span>
  );
}

const COUNTRY_PALETTE: Record<string, string> = {
  TW: "#ef4444",
  JP: "#f97316",
  KR: "#a855f7",
  CN: "#dc2626",
  US: "#3b82f6",
  GB: "#1d4ed8",
  FR: "#0ea5e9",
  DE: "#facc15",
  ES: "#eab308",
  IT: "#10b981",
  AU: "#14b8a6",
  CA: "#f87171",
  SG: "#ec4899",
  TH: "#8b5cf6",
  VN: "#06b6d4",
  MY: "#22c55e",
  ID: "#f43f5e",
  PH: "#84cc16",
  HK: "#f59e0b",
  NZ: "#0d9488",
};

/**
 * Stable color per country code. Falls back to a hashed hue so any country
 * still gets a distinct tint even if it's not in the curated palette.
 */
export function countryColor(code: string): string {
  if (COUNTRY_PALETTE[code]) return COUNTRY_PALETTE[code];
  let hash = 0;
  for (let i = 0; i < code.length; i++) hash = (hash * 31 + code.charCodeAt(i)) & 0xffff;
  return `hsl(${hash % 360}, 65%, 55%)`;
}

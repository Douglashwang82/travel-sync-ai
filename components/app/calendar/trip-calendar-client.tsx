"use client";

import { useEffect, useMemo, useState } from "react";
import { appFetchJson } from "@/lib/app-client";
import { cn } from "@/lib/utils";
import { GridTileError, GridTileSkeleton } from "@/components/app/grids/grid-tile";
import { MonthGrid } from "./month-grid";
import { DayDetailSheet } from "./day-detail-sheet";
import { CountryPicker } from "./country-picker";
import { countryColor } from "./day-cell";
import { useTripCalendar, type DayInfo } from "./use-trip-calendar";
import type { ItineraryResponse } from "@/app/api/app/trips/[tripId]/itinerary/route";

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * Top-level calendar tile content. Renders the month grid plus a per-member
 * availability sidebar that only appears at lg+ viewports to keep narrow
 * tiles legible.
 */
export function TripCalendarClient({ tripId }: { tripId: string }) {
  const cal = useTripCalendar(tripId);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [itemCountByDate, setItemCountByDate] = useState<Map<string, number>>(
    new Map()
  );

  // Pull the trip's itinerary so each day cell can show how many items are
  // already scheduled. Failures here are non-fatal — calendar still renders.
  useEffect(() => {
    void (async () => {
      try {
        const res = await appFetchJson<ItineraryResponse>(
          `/api/app/trips/${tripId}/itinerary`
        );
        const map = new Map<string, number>();
        for (const item of res.items) {
          if (!item.deadline_at) continue;
          const date = item.deadline_at.slice(0, 10);
          map.set(date, (map.get(date) ?? 0) + 1);
        }
        setItemCountByDate(map);
      } catch {
        // ignore
      }
    })();
  }, [tripId]);

  if (cal.error && !cal.loading) {
    return <GridTileError message={cal.error} onRetry={() => void cal.reload()} />;
  }

  if (cal.loading) {
    return <GridTileSkeleton />;
  }

  const { year, month } = cal.monthCursor;

  return (
    <div className="flex h-full flex-col gap-3">
      <Toolbar
        title={`${MONTH_NAMES[month]} ${year}`}
        onPrev={cal.goPrev}
        onNext={cal.goNext}
        onToday={cal.goToday}
        countryCodes={cal.countryCodes}
        onOpenPicker={() => setPickerOpen(true)}
      />

      <div className="grid flex-1 min-h-0 gap-3 lg:grid-cols-[1fr_220px]">
        <MonthGrid
          year={year}
          month={month}
          days={cal.days}
          itemCountByDate={itemCountByDate}
          density="full"
          onSelect={setSelectedDate}
        />
        <MemberColumn
          members={cal.members}
          currentUserId={cal.currentUserId}
          year={year}
          month={month}
          days={cal.days}
        />
      </div>

      <Legend countryCodes={cal.countryCodes} />

      <DayDetailSheet
        date={selectedDate}
        day={selectedDate ? cal.days.get(selectedDate) ?? emptyDayInfo(selectedDate) : null}
        members={cal.members}
        currentUserId={cal.currentUserId}
        open={selectedDate !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedDate(null);
        }}
        onMark={async (date, status, note) => {
          await cal.setMyMark(date, status, note);
        }}
      />

      <CountryPicker
        tripId={tripId}
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        selected={cal.countryCodes}
        onSave={cal.updateCountries}
      />
    </div>
  );
}

function emptyDayInfo(date: string) {
  return {
    date,
    isToday: date === new Date().toISOString().slice(0, 10),
    isInTripWindow: true,
    holidays: [],
    marks: [],
    myMark: null,
    freeCount: 0,
    maybeCount: 0,
    busyCount: 0,
  };
}

function Toolbar({
  title,
  onPrev,
  onNext,
  onToday,
  countryCodes,
  onOpenPicker,
}: {
  title: string;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  countryCodes: string[];
  onOpenPicker: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label="Previous month"
          onClick={onPrev}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[var(--border-hairline)] text-xs hover:bg-[var(--surface-sunken)]"
        >
          ‹
        </button>
        <button
          type="button"
          aria-label="Next month"
          onClick={onNext}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[var(--border-hairline)] text-xs hover:bg-[var(--surface-sunken)]"
        >
          ›
        </button>
        <button
          type="button"
          onClick={onToday}
          className="ml-1 rounded-md border border-[var(--border-hairline)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] hover:bg-[var(--surface-sunken)]"
        >
          Today
        </button>
        <span className="ml-2 text-sm font-semibold text-[var(--text-primary)]">
          {title}
        </span>
      </div>

      <button
        type="button"
        onClick={onOpenPicker}
        className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-hairline)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] hover:border-[var(--accent-line)] hover:text-[var(--text-primary)]"
        title="Pick countries"
      >
        <span aria-hidden>🏳️</span>
        {countryCodes.length === 0
          ? "Pick countries"
          : `${countryCodes.length} ${countryCodes.length === 1 ? "country" : "countries"}`}
      </button>
    </div>
  );
}

function Legend({ countryCodes }: { countryCodes: string[] }) {
  if (countryCodes.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-[10px] text-[var(--text-muted)]">
      <span className="font-semibold uppercase tracking-wider text-[var(--text-faint)]">
        Holidays:
      </span>
      {countryCodes.map((c) => (
        <span key={c} className="inline-flex items-center gap-1">
          <span
            aria-hidden
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: countryColor(c) }}
          />
          {c}
        </span>
      ))}
      <span className="mx-1 text-[var(--text-faint)]">·</span>
      <span className="inline-flex items-center gap-1">
        <span aria-hidden className="inline-block h-2 w-2 rounded-full bg-[#22c55e]" />
        Free
      </span>
      <span className="inline-flex items-center gap-1">
        <span aria-hidden className="inline-block h-2 w-2 rounded-full bg-[#eab308]" />
        Maybe
      </span>
      <span className="inline-flex items-center gap-1">
        <span aria-hidden className="inline-block h-2 w-2 rounded-full bg-[#9ca3af]" />
        Busy
      </span>
    </div>
  );
}

/**
 * lg-and-up sidebar listing each member with a per-day availability bar so
 * the group can eyeball who's free in the current month at a glance.
 */
function MemberColumn({
  members,
  currentUserId,
  year,
  month,
  days,
}: {
  members: { lineUserId: string; displayName: string | null }[];
  currentUserId: string | null;
  year: number;
  month: number;
  days: Map<string, DayInfo>;
}) {
  const dates = useMemo(() => {
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const out: string[] = [];
    for (let i = 0; i < daysInMonth; i++) {
      out.push(new Date(Date.UTC(year, month, 1 + i)).toISOString().slice(0, 10));
    }
    return out;
  }, [year, month]);

  return (
    <div className="hidden flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--border-hairline)] bg-[var(--surface-raised)] p-2 lg:flex">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">
        Members
      </p>
      <ul className="space-y-1.5">
        {members.map((m) => (
          <li
            key={m.lineUserId}
            className={cn(
              "rounded-[var(--radius-sm)] px-1 py-1",
              m.lineUserId === currentUserId && "bg-[var(--accent-line-soft)]"
            )}
          >
            <p className="truncate text-xs font-medium text-[var(--text-primary)]">
              {m.displayName ?? "—"}
            </p>
            <div className="mt-1 flex h-2 gap-[1px]">
              {dates.map((d) => {
                const info = days.get(d);
                const mark = info?.marks.find((x) => x.lineUserId === m.lineUserId);
                const color = !mark
                  ? "var(--border-hairline)"
                  : mark.status === "free"
                    ? "#22c55e"
                    : mark.status === "maybe"
                      ? "#eab308"
                      : "#9ca3af";
                return (
                  <span
                    key={d}
                    title={`${d} — ${mark?.status ?? "no mark"}`}
                    className="block flex-1 rounded-sm"
                    style={{ backgroundColor: color }}
                  />
                );
              })}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}


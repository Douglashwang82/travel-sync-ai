"use client";

import { useMemo } from "react";
import { DayCell } from "./day-cell";
import type { DayInfo } from "./use-trip-calendar";

export function MonthGrid({
  year,
  month, // 0-11
  days,
  itemCountByDate,
  density,
  onSelect,
}: {
  year: number;
  month: number;
  days: Map<string, DayInfo>;
  itemCountByDate: Map<string, number>;
  density: "compact" | "full";
  onSelect: (date: string) => void;
}) {
  // Calendar pages always have 6 rows × 7 cols = 42 cells so the grid height
  // doesn't jump when navigating between months.
  const cells = useMemo(() => buildCalendarCells(year, month), [year, month]);

  return (
    <div className="space-y-1.5">
      {/* Day-of-week header */}
      <div className="grid grid-cols-7 gap-1 px-0.5 text-center text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d}>{d}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {cells.map(({ date, inCurrentMonth }) => {
          const info: DayInfo = days.get(date) ?? {
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
          return (
            <DayCell
              key={date}
              day={info}
              inCurrentMonth={inCurrentMonth}
              itemCount={itemCountByDate.get(date) ?? 0}
              density={density}
              onClick={() => onSelect(date)}
            />
          );
        })}
      </div>
    </div>
  );
}

interface Cell {
  date: string;
  inCurrentMonth: boolean;
}

function buildCalendarCells(year: number, month: number): Cell[] {
  // Monday-first calendar (matches the header above). JS getDay returns 0=Sun;
  // map it to a 0=Mon..6=Sun index.
  const first = new Date(Date.UTC(year, month, 1));
  const offset = (first.getUTCDay() + 6) % 7;
  const start = new Date(Date.UTC(year, month, 1 - offset));
  const cells: Cell[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + i));
    const date = d.toISOString().slice(0, 10);
    cells.push({
      date,
      inCurrentMonth: d.getUTCMonth() === month,
    });
  }
  return cells;
}

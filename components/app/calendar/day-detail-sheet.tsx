"use client";

import { useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { countryColor } from "./day-cell";
import type { AvailabilityStatus } from "@/app/api/app/trips/[tripId]/availability/route";
import type { DayInfo } from "./use-trip-calendar";
import type { AppMember } from "@/app/api/app/trips/[tripId]/members/route";

/**
 * Right-side detail panel for a single calendar day:
 *  - Holidays (with country tint)
 *  - "Mark me free / maybe / busy" buttons + optional note
 *  - Per-member availability list
 */
export function DayDetailSheet({
  date,
  day,
  members,
  currentUserId,
  open,
  onOpenChange,
  onMark,
}: {
  date: string | null;
  day: DayInfo | null;
  members: AppMember[];
  currentUserId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMark: (
    date: string,
    status: AvailabilityStatus | null,
    note?: string
  ) => Promise<void> | void;
}) {
  const [noteDraft, setNoteDraft] = useState("");

  const myStatus = day?.myMark?.status ?? null;
  const headline = date ? formatDateHeadline(date) : "";

  const memberStatusById = new Map<string, AvailabilityStatus>();
  for (const m of day?.marks ?? []) memberStatusById.set(m.lineUserId, m.status);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{headline}</SheetTitle>
          <SheetDescription>
            {day?.isInTripWindow
              ? "Inside the trip window."
              : "Outside the current trip dates."}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-5 space-y-5">
          {/* Holidays */}
          <section className="space-y-2">
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">
              National holidays
            </h3>
            {day && day.holidays.length > 0 ? (
              <ul className="space-y-1.5">
                {day.holidays.map((h) => (
                  <li
                    key={`${h.country}-${h.name}`}
                    className="flex items-center gap-2 text-sm"
                  >
                    <span
                      aria-hidden
                      className="inline-block h-2 w-2 rounded-full"
                      style={{ backgroundColor: countryColor(h.country) }}
                    />
                    <span className="font-medium">{h.country}</span>
                    <span className="text-[var(--text-muted)]">{h.name}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-[var(--text-muted)]">No holidays.</p>
            )}
          </section>

          {/* Self mark */}
          <section className="space-y-2">
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">
              Your availability
            </h3>
            <div className="flex flex-wrap gap-1.5">
              <MarkButton
                active={myStatus === "free"}
                color="#22c55e"
                label="Free"
                onClick={() => date && onMark(date, "free", noteDraft || undefined)}
              />
              <MarkButton
                active={myStatus === "maybe"}
                color="#eab308"
                label="Maybe"
                onClick={() => date && onMark(date, "maybe", noteDraft || undefined)}
              />
              <MarkButton
                active={myStatus === "busy"}
                color="#9ca3af"
                label="Busy"
                onClick={() => date && onMark(date, "busy", noteDraft || undefined)}
              />
              {myStatus && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2 text-xs"
                  onClick={() => date && onMark(date, null)}
                >
                  Clear
                </Button>
              )}
            </div>
            {day?.myMark?.note && (
              <p className="text-xs text-[var(--text-muted)]">
                Your note: {day.myMark.note}
              </p>
            )}
            <input
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              placeholder="Add a note (optional)"
              maxLength={140}
              className="h-8 w-full rounded-[var(--radius-sm)] border border-[var(--border-hairline)] bg-[var(--surface-raised)] px-2 text-xs"
            />
          </section>

          {/* Members */}
          <section className="space-y-2">
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">
              Members ({day ? day.freeCount : 0} free · {day ? day.maybeCount : 0} maybe · {day ? day.busyCount : 0} busy)
            </h3>
            <ul className="space-y-1.5">
              {members.map((m) => {
                const status = memberStatusById.get(m.lineUserId) ?? null;
                return (
                  <li
                    key={m.lineUserId}
                    className={cn(
                      "flex items-center justify-between rounded-[var(--radius-sm)] border border-[var(--border-hairline)] px-2.5 py-1.5",
                      m.lineUserId === currentUserId &&
                        "border-[var(--accent-line)]"
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <span
                        aria-hidden
                        className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[var(--accent-line-soft)] text-[10px] font-semibold text-[var(--accent-line)]"
                      >
                        {(m.displayName ?? "?").slice(0, 1).toUpperCase()}
                      </span>
                      <span className="text-sm">{m.displayName ?? "—"}</span>
                    </span>
                    <StatusBadge status={status} />
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function MarkButton({
  active,
  color,
  label,
  onClick,
}: {
  active: boolean;
  color: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors",
        active
          ? "border-transparent text-white"
          : "border-[var(--border-hairline)] text-[var(--text-primary)] hover:bg-[var(--surface-sunken)]"
      )}
      style={active ? { backgroundColor: color } : undefined}
    >
      <span
        aria-hidden
        className="inline-block h-2 w-2 rounded-full"
        style={{ backgroundColor: active ? "white" : color }}
      />
      {label}
    </button>
  );
}

function StatusBadge({ status }: { status: AvailabilityStatus | null }) {
  if (!status)
    return (
      <span className="text-[10px] uppercase tracking-wider text-[var(--text-faint)]">
        no mark
      </span>
    );
  const color =
    status === "free" ? "#22c55e" : status === "maybe" ? "#eab308" : "#9ca3af";
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white"
      style={{ backgroundColor: color }}
    >
      {status}
    </span>
  );
}

function formatDateHeadline(date: string): string {
  const d = new Date(date + "T00:00:00");
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

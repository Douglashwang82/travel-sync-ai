"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { appFetchJson } from "@/lib/app-client";
import { cn } from "@/lib/utils";
import {
  TabPageHeader,
  TabError,
  TabSkeleton,
  TabEmptyState,
} from "@/components/app/tab-shell";
import type {
  DayNoteEntry,
  ItineraryEntry,
  ItineraryResponse,
} from "@/app/api/app/trips/[tripId]/itinerary/route";
import type { AppMember } from "@/app/api/app/trips/[tripId]/members/route";
import type {
  DaySuggestion,
  SuggestDayResponse,
} from "@/app/api/app/trips/[tripId]/suggest-day/route";

// ─── Constants ────────────────────────────────────────────────────────────────

const TYPE_LABEL: Record<string, string> = {
  hotel: "Hotel",
  restaurant: "Food",
  activity: "Activity",
  transport: "Transport",
  flight: "Flight",
  insurance: "Insurance",
  other: "Item",
};

const TYPE_ICON: Record<string, string> = {
  hotel: "🏨",
  restaurant: "🍽️",
  activity: "🎯",
  transport: "🚌",
  flight: "✈️",
  insurance: "🛡️",
  other: "📌",
};

const TYPE_DOT: Record<string, string> = {
  hotel: "bg-blue-500",
  restaurant: "bg-orange-500",
  activity: "bg-emerald-500",
  transport: "bg-slate-500",
  flight: "bg-sky-500",
  insurance: "bg-violet-500",
  other: "bg-[var(--text-muted)]",
};

const STAGE_TONE: Record<string, string> = {
  confirmed:
    "bg-[#dcfce7] text-[#166534] dark:bg-[#14532d] dark:text-[#86efac]",
  pending:
    "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  todo: "bg-[var(--surface-sunken)] text-[var(--text-muted)]",
};

const UNASSIGNED = "__unassigned__";
const UNSCHEDULED_KEY = "zzz-unscheduled";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toInputLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function generateDateRange(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const current = new Date(startDate + "T00:00:00");
  const end = new Date(endDate + "T00:00:00");
  while (current <= end) {
    dates.push(current.toISOString().split("T")[0]);
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

function dateKey(iso: string | null): string {
  if (!iso) return UNSCHEDULED_KEY;
  return new Date(iso).toISOString().split("T")[0];
}

function timeOfDayBucket(iso: string | null): "morning" | "afternoon" | "evening" | "anytime" {
  if (!iso) return "anytime";
  const h = new Date(iso).getHours();
  if (h < 12) return "morning";
  if (h < 17) return "afternoon";
  return "evening";
}

function formatDayLabel(dateStr: string): {
  weekday: string;
  monthDay: string;
} {
  const d = new Date(dateStr + "T00:00:00");
  return {
    weekday: d.toLocaleDateString(undefined, { weekday: "short" }),
    monthDay: d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    }),
  };
}

function isToday(dateStr: string): boolean {
  return dateStr === new Date().toISOString().split("T")[0];
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface TimelineDay {
  key: string;
  dayNumber: number | null;
  weekday: string;
  monthDay: string;
  isToday: boolean;
  isUnscheduled: boolean;
  isEmpty: boolean;
  items: ItineraryEntry[];
  note: DayNoteEntry | null;
}

// ─── Root component ───────────────────────────────────────────────────────────

export function TripItineraryClient({ tripId }: { tripId: string }) {
  const [data, setData] = useState<ItineraryResponse | null>(null);
  const [members, setMembers] = useState<AppMember[]>([]);
  const [role, setRole] = useState<"organizer" | "member">("member");
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "confirmed" | "pending" | "todo">("all");
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [it, ms, tr] = await Promise.all([
        appFetchJson<ItineraryResponse>(`/api/app/trips/${tripId}/itinerary`),
        appFetchJson<{ members: AppMember[] }>(`/api/app/trips/${tripId}/members`),
        appFetchJson<{ role: "organizer" | "member" }>(`/api/app/trips/${tripId}`),
      ]);
      setError(null);
      setData(it);
      setMembers(ms.members);
      setRole(tr.role);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load itinerary");
    }
  }, [tripId]);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  const days: TimelineDay[] = useMemo(() => {
    if (!data) return [];

    const filtered = data.items.filter((i) =>
      filter === "all" ? true : i.stage === filter
    );

    const buckets = new Map<string, ItineraryEntry[]>();
    for (const item of filtered) {
      const key = dateKey(item.deadline_at);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key)!.push(item);
    }
    // Sort items inside each day by time
    for (const arr of buckets.values()) {
      arr.sort((a, b) => {
        const ta = a.deadline_at
          ? new Date(a.deadline_at).getTime()
          : Number.POSITIVE_INFINITY;
        const tb = b.deadline_at
          ? new Date(b.deadline_at).getTime()
          : Number.POSITIVE_INFINITY;
        return ta - tb;
      });
    }

    let allDayKeys: string[] = [];
    if (data.trip.start_date && data.trip.end_date) {
      allDayKeys = generateDateRange(data.trip.start_date, data.trip.end_date);
    }
    const itemKeys = Array.from(buckets.keys()).filter(
      (k) => k !== UNSCHEDULED_KEY
    );
    for (const k of itemKeys) {
      if (!allDayKeys.includes(k)) allDayKeys.push(k);
    }
    allDayKeys.sort();

    const tripStart = data.trip.start_date;
    const result: TimelineDay[] = allDayKeys.map((key) => {
      const items = buckets.get(key) ?? [];
      const labels = formatDayLabel(key);
      let dayNumber: number | null = null;
      if (tripStart) {
        const start = new Date(tripStart + "T00:00:00").getTime();
        const here = new Date(key + "T00:00:00").getTime();
        dayNumber = Math.round((here - start) / 86_400_000) + 1;
      }
      return {
        key,
        dayNumber,
        weekday: labels.weekday,
        monthDay: labels.monthDay,
        isToday: isToday(key),
        isUnscheduled: false,
        isEmpty: items.length === 0,
        items,
        note: data.trip.day_notes?.[key] ?? null,
      };
    });

    if (buckets.has(UNSCHEDULED_KEY)) {
      result.push({
        key: UNSCHEDULED_KEY,
        dayNumber: null,
        weekday: "—",
        monthDay: "Unscheduled",
        isToday: false,
        isUnscheduled: true,
        isEmpty: false,
        items: buckets.get(UNSCHEDULED_KEY)!,
        note: null,
      });
    }

    return result;
  }, [data, filter]);

  useEffect(() => {
    if (selectedDayKey && !days.some((day) => day.key === selectedDayKey)) {
      setSelectedDayKey(null);
    }
  }, [days, selectedDayKey]);

  const visibleDays = selectedDayKey
    ? days.filter((day) => day.key === selectedDayKey)
    : days;

  if (error) {
    return <TabError message={error} onRetry={() => void load()} />;
  }

  if (!data) {
    return (
      <div className="space-y-4">
        {[...Array(4)].map((_, i) => (
          <TabSkeleton key={i} height={128} />
        ))}
      </div>
    );
  }

  const counts = {
    all: data.items.length,
    confirmed: data.items.filter((i) => i.stage === "confirmed").length,
    pending: data.items.filter((i) => i.stage === "pending").length,
    todo: data.items.filter((i) => i.stage === "todo").length,
  };

  return (
    <div className="space-y-5">
      <Toolbar
        filter={filter}
        setFilter={setFilter}
        counts={counts}
        days={days}
        selectedDayKey={selectedDayKey}
        onSelectDay={setSelectedDayKey}
      />

      {visibleDays.length === 0 ? (
        <TabEmptyState message="Nothing on the timeline yet. Add an item or set trip dates to start planning." />
      ) : (
        <Timeline
          days={visibleDays}
          tripId={tripId}
          members={members}
          isOrganizer={role === "organizer"}
          currency={data.trip.budget_currency || "TWD"}
          onUpdated={() => void load()}
        />
      )}
    </div>
  );
}

// ─── Toolbar ──────────────────────────────────────────────────────────────────

function Toolbar({
  filter,
  setFilter,
  counts,
  days,
  selectedDayKey,
  onSelectDay,
}: {
  filter: "all" | "confirmed" | "pending" | "todo";
  setFilter: (f: "all" | "confirmed" | "pending" | "todo") => void;
  counts: { all: number; confirmed: number; pending: number; todo: number };
  days: TimelineDay[];
  selectedDayKey: string | null;
  onSelectDay: (key: string | null) => void;
}) {
  const totalDays = days.filter((d) => !d.isUnscheduled).length;
  const itemsCount = days.reduce((s, d) => s + d.items.length, 0);

  return (
    <div className="space-y-3">
      <TabPageHeader
        title="Timeline"
        subtitle={`${totalDays} day${totalDays === 1 ? "" : "s"} · ${itemsCount} item${itemsCount === 1 ? "" : "s"} on the timeline`}
        actions={
          <div className="flex flex-wrap items-center gap-1.5 rounded-full border border-[var(--border-hairline)] p-0.5 text-xs">
            {(
              [
                { v: "all", label: "All", count: counts.all },
                { v: "confirmed", label: "Confirmed", count: counts.confirmed },
                { v: "pending", label: "Pending vote", count: counts.pending },
                { v: "todo", label: "To-do", count: counts.todo },
              ] as const
            ).map((f) => (
              <button
                key={f.v}
                type="button"
                onClick={() => setFilter(f.v)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-medium transition-colors",
                  filter === f.v
                    ? "bg-[var(--text-primary)] text-[var(--surface-raised)]"
                    : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                )}
              >
                {f.label}
                <span
                  className={cn(
                    "rounded-full px-1.5 text-[10px] font-semibold",
                    filter === f.v
                      ? "bg-[var(--surface-raised)]/20"
                      : "bg-[var(--surface-sunken)]"
                  )}
                >
                  {f.count}
                </span>
              </button>
            ))}
          </div>
        }
      />

      {days.length > 1 && (
        <div className="-mx-1 flex flex-wrap gap-1.5 px-1">
          {selectedDayKey && (
            <button
              type="button"
              onClick={() => onSelectDay(null)}
              aria-pressed={selectedDayKey === null}
              className="inline-flex items-center gap-1 rounded-full border border-[var(--text-primary)] bg-[var(--text-primary)] px-2.5 py-1 text-[11px] font-medium text-[var(--surface-raised)] transition-colors"
            >
              All days
            </button>
          )}
          {days.map((d) => (
            <button
              key={d.key}
              type="button"
              onClick={() => onSelectDay(d.key)}
              aria-pressed={selectedDayKey === d.key}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                selectedDayKey === d.key
                  ? "border-[var(--text-primary)] bg-[var(--text-primary)] text-[var(--surface-raised)]"
                  : d.isToday
                    ? "border-[var(--accent-line)] bg-[var(--accent-line-soft)] text-[var(--accent-line)]"
                    : "border-[var(--border-hairline)] text-[var(--text-muted)] hover:bg-[var(--surface-sunken)]"
              )}
            >
              {d.dayNumber != null && (
                <span className="font-semibold">D{d.dayNumber}</span>
              )}
              <span>{d.monthDay}</span>
              {d.items.length > 0 && (
                <span className="rounded-full bg-[var(--surface-sunken)] px-1.5 text-[10px] font-semibold text-[var(--text-muted)]">
                  {d.items.length}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Timeline ─────────────────────────────────────────────────────────────────

function Timeline({
  days,
  tripId,
  members,
  isOrganizer,
  currency,
  onUpdated,
}: {
  days: TimelineDay[];
  tripId: string;
  members: AppMember[];
  isOrganizer: boolean;
  currency: string;
  onUpdated: () => void;
}) {
  return (
    <div className="relative">
      {/* Vertical spine */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-[3.25rem] top-0 bottom-0 hidden w-px bg-[var(--border-hairline)] sm:block"
      />

      <div className="space-y-8">
        {days.map((day) => (
          <DayBlock
            key={day.key}
            day={day}
            tripId={tripId}
            members={members}
            isOrganizer={isOrganizer}
            currency={currency}
            onUpdated={onUpdated}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Day heading (note + stats) ──────────────────────────────────────────────

function DayHeading({
  day,
  tripId,
  currency,
  canAddManualItem,
  onAddManualItem,
  onSaved,
}: {
  day: TimelineDay;
  tripId: string;
  currency: string;
  canAddManualItem: boolean;
  onAddManualItem: () => void;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(day.note?.note ?? "");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Keep draft in sync if the note is updated by another client
  useEffect(() => {
    if (!editing) setDraft(day.note?.note ?? "");
  }, [day.note?.note, editing]);

  async function save(noteOrNull: string | null) {
    setSaving(true);
    setSaveError(null);
    try {
      await appFetchJson(`/api/app/trips/${tripId}/day-notes`, {
        method: "PATCH",
        body: JSON.stringify({
          date: day.key,
          note: noteOrNull,
        }),
      });
      setEditing(false);
      onSaved();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save note");
    } finally {
      setSaving(false);
    }
  }

  const stats = useMemo(() => buildDayStats(day, currency), [day, currency]);
  const canEdit = !day.isUnscheduled;

  return (
    <div className="mb-3 space-y-1.5">
      {/* Pill row — Day N · Today */}
      <div className="flex flex-wrap items-center gap-1.5">
        {day.dayNumber != null && (
          <span className="rounded-full bg-[var(--secondary)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            Day {day.dayNumber}
          </span>
        )}
        {day.isToday && (
          <span className="rounded-full bg-[var(--primary)]/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--primary)]">
            Today
          </span>
        )}
        {day.isUnscheduled && (
          <span className="rounded-full bg-[var(--secondary)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            Unscheduled
          </span>
        )}
        {stats.typeIcons.length > 0 && (
          <span
            aria-label="Item types"
            className="text-sm leading-none"
            title={stats.typeIcons.map((t) => t.label).join(", ")}
          >
            {stats.typeIcons.map((t) => t.icon).join(" ")}
          </span>
        )}
      </div>

      {/* Editable note OR auto stats line */}
      {editing ? (
        <div className="space-y-1.5">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="One-line summary, e.g. ‘Travel day: Osaka → Kyoto’"
            maxLength={140}
            autoFocus
            disabled={saving}
            className="h-8 text-sm"
          />
          {saveError && (
            <p className="text-[11px] text-destructive">{saveError}</p>
          )}
          <div className="flex flex-wrap gap-1.5">
            <Button
              size="sm"
              className="h-7 px-2.5 text-[11px]"
              onClick={() => void save(draft.trim() || null)}
              disabled={saving}
            >
              {saving ? "Saving…" : "Save"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2.5 text-[11px]"
              onClick={() => {
                setEditing(false);
                setDraft(day.note?.note ?? "");
                setSaveError(null);
              }}
              disabled={saving}
            >
              Cancel
            </Button>
            {day.note && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2.5 text-[11px] text-[var(--text-muted)]"
                onClick={() => void save(null)}
                disabled={saving}
              >
                Remove
              </Button>
            )}
          </div>
        </div>
      ) : day.note ? (
        <button
          type="button"
          onClick={() => canEdit && setEditing(true)}
          className={cn(
            "block w-full rounded-lg border-l-2 border-[var(--primary)] bg-[var(--primary)]/5 px-3 py-1.5 text-left transition-colors",
            canEdit ? "hover:bg-[var(--primary)]/10" : "cursor-default"
          )}
          title={
            day.note.updatedByName
              ? `Last edited by ${day.note.updatedByName}`
              : undefined
          }
        >
          <p className="text-sm font-medium leading-snug">{day.note.note}</p>
          <p className="mt-0.5 text-[10px] text-[var(--text-muted)]">
            {day.note.updatedByName ? `${day.note.updatedByName} · ` : ""}
            {stats.line}
          </p>
        </button>
      ) : (
        <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
          <span>{stats.line}</span>
          {canEdit && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-[11px] font-medium text-[var(--primary)] hover:underline"
            >
              + Add summary
            </button>
          )}
          {canAddManualItem && (
            <button
              type="button"
              onClick={onAddManualItem}
              className="text-[11px] font-medium text-[var(--primary)] hover:underline"
            >
              + Add manually
            </button>
          )}
        </div>
      )}
    </div>
  );
}

interface DayStats {
  line: string;
  typeIcons: Array<{ icon: string; label: string }>;
}

function buildDayStats(day: TimelineDay, currency: string): DayStats {
  if (day.items.length === 0) {
    return { line: "Nothing planned yet", typeIcons: [] };
  }
  const counts = { confirmed: 0, pending: 0, todo: 0 };
  const types = new Set<string>();
  for (const item of day.items) {
    if (item.stage === "confirmed") counts.confirmed++;
    else if (item.stage === "pending") counts.pending++;
    else counts.todo++;
    types.add(item.item_type);
  }
  const parts: string[] = [];
  if (counts.confirmed > 0) parts.push(`${counts.confirmed} confirmed`);
  if (counts.pending > 0) parts.push(`${counts.pending} pending`);
  if (counts.todo > 0) parts.push(`${counts.todo} to-do`);

  const totalCost = estimateDayCost(day.items);
  if (totalCost != null) {
    parts.push(`~${currency} ${totalCost.toLocaleString()}`);
  }

  const typeIcons = Array.from(types)
    .slice(0, 5)
    .map((t) => ({
      icon: TYPE_ICON[t] ?? TYPE_ICON.other,
      label: TYPE_LABEL[t] ?? "Item",
    }));

  return {
    line: parts.length > 0 ? parts.join(" · ") : "No status yet",
    typeIcons,
  };
}

function estimateDayCost(items: ItineraryEntry[]): number | null {
  let total = 0;
  let any = false;
  for (const item of items) {
    const raw = item.confirmed_option?.price_level;
    if (!raw) continue;
    const match = String(raw).match(/[\d,]+(\.\d+)?/);
    if (!match) continue;
    const num = Number(match[0].replace(/,/g, ""));
    if (Number.isFinite(num) && num > 0) {
      total += num;
      any = true;
    }
  }
  return any ? Math.round(total) : null;
}

// ─── Day block ────────────────────────────────────────────────────────────────

function DayBlock({
  day,
  tripId,
  members,
  isOrganizer,
  currency,
  onUpdated,
}: {
  day: TimelineDay;
  tripId: string;
  members: AppMember[];
  isOrganizer: boolean;
  currency: string;
  onUpdated: () => void;
}) {
  const [manualOpen, setManualOpen] = useState(false);

  return (
    <section
      id={`day-${day.key}`}
      className="relative scroll-mt-24 sm:pl-[5.5rem]"
    >
      {/* Date marker — pinned to the spine on desktop */}
      <header className="mb-3 sm:absolute sm:left-0 sm:top-0 sm:mb-0 sm:w-[4.5rem]">
        <div
          className={cn(
            "flex h-14 w-14 flex-col items-center justify-center rounded-2xl border text-center shadow-sm",
            day.isToday
              ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)]"
              : day.isUnscheduled
                ? "border-dashed border-[var(--border)] bg-[var(--secondary)]/40 text-[var(--text-muted)]"
                : "border-[var(--border)] bg-[var(--background)] text-[var(--foreground)]"
          )}
        >
          {day.isUnscheduled ? (
            <span className="text-lg" aria-hidden>
              ⏳
            </span>
          ) : (
            <>
              <span className="text-[9px] font-semibold uppercase tracking-wide opacity-70">
                {day.weekday}
              </span>
              <span className="text-lg font-bold leading-none">
                {day.monthDay.split(" ")[1]}
              </span>
              <span className="text-[8px] font-semibold uppercase opacity-70">
                {day.monthDay.split(" ")[0]}
              </span>
            </>
          )}
        </div>
      </header>

      {/* Day heading: Day pill row + editable note + auto stats line */}
      <DayHeading
        day={day}
        tripId={tripId}
        currency={currency}
        canAddManualItem={isOrganizer && !day.isUnscheduled}
        onAddManualItem={() => setManualOpen(true)}
        onSaved={onUpdated}
      />

      {/* Body */}
      {day.isEmpty ? (
        <EmptyDayBlock
          date={day.key}
          tripId={tripId}
          isOrganizer={isOrganizer}
          onAdded={onUpdated}
        />
      ) : (
        <div className="space-y-3">
          {day.items.map((item) => (
            <TimelineEvent
              key={item.id}
              item={item}
              tripId={tripId}
              members={members}
              isOrganizer={isOrganizer}
              onUpdated={onUpdated}
            />
          ))}
        </div>
      )}
      {manualOpen && (
        <ManualItineraryItemDialog
          tripId={tripId}
          date={day.key}
          onClose={() => setManualOpen(false)}
          onAdded={() => {
            setManualOpen(false);
            onUpdated();
          }}
        />
      )}
    </section>
  );
}

// ─── Timeline event card ──────────────────────────────────────────────────────

function TimelineEvent({
  item,
  tripId,
  members,
  isOrganizer,
  onUpdated,
}: {
  item: ItineraryEntry;
  tripId: string;
  members: AppMember[];
  isOrganizer: boolean;
  onUpdated: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [deadline, setDeadline] = useState(toInputLocal(item.deadline_at));
  const [assignee, setAssignee] = useState(
    item.assigned_to_line_user_id ?? UNASSIGNED
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [addOptionOpen, setAddOptionOpen] = useState(false);

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    try {
      await appFetchJson(`/api/app/trips/${tripId}/items`, {
        method: "POST",
        body: JSON.stringify({
          action: "update",
          itemId: item.id,
          deadlineAt: deadline ? new Date(deadline).toISOString() : null,
          assignedTo: assignee === UNASSIGNED ? null : assignee,
        }),
      });
      setEditing(false);
      onUpdated();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  const option = item.confirmed_option;
  const assigneeName = item.assigned_to_line_user_id
    ? (members.find(
        (m) => m.lineUserId === item.assigned_to_line_user_id
      )?.displayName ?? item.assigned_to_line_user_id)
    : null;
  const time = item.deadline_at
    ? new Date(item.deadline_at).toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;
  const tod = timeOfDayBucket(item.deadline_at);
  const canAddOption =
    isOrganizer && item.item_kind === "decision" && item.stage !== "confirmed";

  return (
    <article className="relative">
      {/* Spine dot — desktop only */}
      <span
        aria-hidden
        className={cn(
          "absolute -left-[2.6rem] top-5 hidden h-3 w-3 rounded-full ring-4 ring-[var(--background)] sm:block",
          TYPE_DOT[item.item_type] ?? TYPE_DOT.other
        )}
      />

      <div className="surface-tile tile-interactive overflow-hidden">
        <div className="flex flex-col sm:flex-row">
          {/* Time gutter */}
          <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] px-4 py-2 text-xs sm:w-32 sm:flex-col sm:items-start sm:justify-center sm:gap-0.5 sm:border-b-0 sm:border-r sm:py-3">
            {time ? (
              <>
                <span className="text-base font-bold text-[var(--foreground)] tabular-nums">
                  {time}
                </span>
                <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
                  {tod}
                </span>
              </>
            ) : (
              <span className="text-xs italic text-[var(--text-muted)]">
                Anytime
              </span>
            )}
          </div>

          {/* Optional image */}
          {option?.image_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={option.image_url}
              alt={option.name}
              className="h-32 w-full object-cover sm:h-auto sm:w-32"
              loading="lazy"
            />
          )}

          {/* Body */}
          <div className="min-w-0 flex-1 space-y-2 px-4 py-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span aria-hidden className="text-base">
                    {TYPE_ICON[item.item_type] ?? TYPE_ICON.other}
                  </span>
                  <Badge variant="secondary" className="text-[9px] uppercase">
                    {TYPE_LABEL[item.item_type] ?? "Item"}
                  </Badge>
                  <span
                    className={cn(
                      "rounded-full px-1.5 py-0.5 text-[9px] font-semibold capitalize",
                      STAGE_TONE[item.stage] ?? STAGE_TONE.todo
                    )}
                  >
                    {item.stage === "pending" ? "pending vote" : item.stage}
                  </span>
                  {item.booking_status === "needed" && (
                    <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                      Book
                    </span>
                  )}
                  {item.booking_status === "booked" && (
                    <span className="rounded-full bg-[#dcfce7] px-1.5 py-0.5 text-[9px] font-semibold text-[#166534] dark:bg-[#14532d] dark:text-[#86efac]">
                      ✓ Booked
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm font-semibold leading-snug">
                  {item.title}
                </p>
                {option && option.name !== item.title && (
                  <p className="text-[11px] text-[var(--text-muted)]">
                    {option.name}
                  </p>
                )}
              </div>
              {assigneeName && (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                  <span className="flex h-4 w-4 items-center justify-center rounded-full bg-blue-200 text-[8px] font-bold dark:bg-blue-900">
                    {assigneeName.slice(0, 1).toUpperCase()}
                  </span>
                  {assigneeName}
                </span>
              )}
            </div>

            {item.description && (
              <p className="text-[12px] leading-relaxed text-[var(--text-muted)]">
                {item.description}
              </p>
            )}

            {option?.address && (
              <p className="text-[11px] text-[var(--text-muted)]">
                📍 {option.address}
              </p>
            )}

            {(option?.rating ||
              option?.price_level ||
              option?.google_maps_url ||
              option?.booking_url) && (
              <div className="flex flex-wrap items-center gap-3 text-[11px]">
                {option.rating != null && (
                  <span className="text-[var(--text-muted)]">
                    ★ {option.rating}
                  </span>
                )}
                {option.price_level && (
                  <span className="text-[var(--text-muted)]">
                    {option.price_level}
                  </span>
                )}
                {option.google_maps_url && (
                  <a
                    href={option.google_maps_url}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-[var(--primary)] underline underline-offset-2"
                  >
                    Maps
                  </a>
                )}
                {option.booking_url && (
                  <a
                    href={option.booking_url}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-[var(--primary)] underline underline-offset-2"
                  >
                    Book
                  </a>
                )}
              </div>
            )}

            {isOrganizer && (
              <div className="border-t border-[var(--border)] pt-2">
                {editing ? (
                  <div className="space-y-2">
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div className="space-y-1">
                        <Label
                          htmlFor={`it-dl-${item.id}`}
                          className="text-[10px]"
                        >
                          Time
                        </Label>
                        <Input
                          id={`it-dl-${item.id}`}
                          type="datetime-local"
                          value={deadline}
                          onChange={(e) => setDeadline(e.target.value)}
                          className="h-8 text-xs"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px]">Assigned to</Label>
                        <Select value={assignee} onValueChange={setAssignee}>
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue placeholder="Unassigned" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={UNASSIGNED}>
                              Unassigned
                            </SelectItem>
                            {members.map((m) => (
                              <SelectItem key={m.lineUserId} value={m.lineUserId}>
                                {m.displayName ?? m.lineUserId}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    {saveError && (
                      <p className="text-[10px] text-destructive">
                        {saveError}
                      </p>
                    )}
                    <div className="flex justify-end gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-[11px]"
                        onClick={() => {
                          setEditing(false);
                          setDeadline(toInputLocal(item.deadline_at));
                          setAssignee(
                            item.assigned_to_line_user_id ?? UNASSIGNED
                          );
                          setSaveError(null);
                        }}
                        disabled={saving}
                      >
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        className="h-7 px-2 text-[11px]"
                        onClick={() => void handleSave()}
                        disabled={saving}
                      >
                        {saving ? "Saving…" : "Save"}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setEditing(true)}
                      className="text-[11px] text-[var(--text-muted)] underline underline-offset-2 hover:text-[var(--foreground)]"
                    >
                      Edit time / assignment
                    </button>
                    {canAddOption && (
                      <button
                        type="button"
                        onClick={() => setAddOptionOpen(true)}
                        className="text-[11px] font-medium text-[var(--primary)] underline underline-offset-2 hover:text-[var(--foreground)]"
                      >
                        Add option
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      {addOptionOpen && (
        <AddOptionDialog
          tripId={tripId}
          itemId={item.id}
          onClose={() => setAddOptionOpen(false)}
          onAdded={() => {
            setAddOptionOpen(false);
            onUpdated();
          }}
        />
      )}
    </article>
  );
}

// ─── Empty day block ──────────────────────────────────────────────────────────

function EmptyDayBlock({
  date,
  tripId,
  isOrganizer,
  onAdded,
}: {
  date: string;
  tripId: string;
  isOrganizer: boolean;
  onAdded: () => void;
}) {
  const [phase, setPhase] = useState<"idle" | "loading" | "done" | "error">(
    "idle"
  );
  const [suggestions, setSuggestions] = useState<DaySuggestion[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [addingTitle, setAddingTitle] = useState<string | null>(null);
  const dotRef = useRef<HTMLSpanElement>(null);

  async function handleSuggest() {
    setPhase("loading");
    setErrorMsg(null);
    try {
      const res = await appFetchJson<SuggestDayResponse>(
        `/api/app/trips/${tripId}/suggest-day?date=${date}`
      );
      setSuggestions(res.suggestions ?? []);
      setPhase("done");
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Failed to get suggestions"
      );
      setPhase("error");
    }
  }

  async function handleAdd(s: DaySuggestion) {
    setAddingTitle(s.title);
    try {
      await appFetchJson(`/api/app/trips/${tripId}/items`, {
        method: "POST",
        body: JSON.stringify({
          action: "create",
          title: s.title,
          itemType: s.item_type,
          description: s.description,
          deadlineAt: `${date}T12:00:00.000Z`,
          fromSuggestion: true,
        }),
      });
      onAdded();
    } catch {
      // keep suggestions visible so user can retry
    } finally {
      setAddingTitle(null);
    }
  }

  return (
    <div className="relative">
      <span
        ref={dotRef}
        aria-hidden
        className="absolute -left-[2.6rem] top-5 hidden h-3 w-3 rounded-full bg-[var(--border)] ring-4 ring-[var(--background)] sm:block"
      />
      {phase === "idle" ? (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => void handleSuggest()}
            className="group flex w-full items-center justify-between gap-3 rounded-2xl border border-dashed border-[var(--border)] px-4 py-4 text-left transition-colors hover:border-[var(--primary)]/40 hover:bg-[var(--secondary)]/40"
          >
            <div className="space-y-0.5">
              <p className="text-sm font-medium text-[var(--text-muted)]">
                Nothing planned
              </p>
              <p className="text-[11px] text-[var(--text-muted)]/80">
                Tap for AI suggestions tailored to this day
              </p>
            </div>
            <span className="text-[11px] font-semibold text-[var(--primary)] opacity-70 group-hover:opacity-100">
              ✨ Suggest
            </span>
          </button>
        </div>
      ) : phase === "loading" ? (
        <div className="surface-tile space-y-2 p-4">
          {[...Array(3)].map((_, i) => (
            <div
              key={i}
              className="flex animate-pulse items-center gap-2 rounded-xl bg-[var(--secondary)] p-2.5"
            >
              <div className="h-7 w-7 shrink-0 rounded-lg bg-[var(--border)]" />
              <div className="flex-1 space-y-1.5">
                <div className="h-2.5 w-2/3 rounded-full bg-[var(--border)]" />
                <div className="h-2 w-1/2 rounded-full bg-[var(--border)]" />
              </div>
            </div>
          ))}
          <p className="text-center text-[11px] text-[var(--text-muted)]">
            Getting AI suggestions…
          </p>
        </div>
      ) : phase === "error" ? (
        <div className="rounded-2xl border border-dashed border-red-200 bg-red-50 p-4 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {errorMsg}{" "}
          <button
            type="button"
            onClick={() => void handleSuggest()}
            className="ml-1 underline underline-offset-2"
          >
            Retry
          </button>
        </div>
      ) : (
        <div className="surface-tile space-y-2 p-3">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
              ✨ AI suggestions
            </p>
            <button
              type="button"
              onClick={() => void handleSuggest()}
              className="text-[10px] text-[var(--text-muted)] underline underline-offset-2 hover:text-[var(--foreground)]"
            >
              Refresh
            </button>
          </div>
          {suggestions.map((s) => (
            <div
              key={s.title}
              className="rounded-xl border border-[var(--border)] bg-[var(--secondary)]/40 p-2.5"
            >
              <div className="flex items-start gap-2">
                <span className="mt-0.5 text-base" aria-hidden>
                  {TYPE_ICON[s.item_type] ?? TYPE_ICON.other}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] font-semibold leading-snug">
                    {s.title}
                  </p>
                  <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-[var(--text-muted)]">
                    {s.description}
                  </p>
                  {s.reason && (
                    <p className="mt-0.5 text-[10px] italic text-[var(--text-muted)]/70">
                      {s.reason}
                    </p>
                  )}
                </div>
                {isOrganizer && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void handleAdd(s)}
                    disabled={addingTitle !== null}
                    className="h-6 shrink-0 px-2 text-[10px]"
                  >
                    {addingTitle === s.title ? "Adding…" : "Add"}
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ManualItineraryItemDialog({
  tripId,
  date,
  onClose,
  onAdded,
}: {
  tripId: string;
  date: string;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [title, setTitle] = useState("");
  const [itemType, setItemType] = useState("activity");
  const [description, setDescription] = useState("");
  const [time, setTime] = useState(`${date}T12:00`);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAdd() {
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      setError("Item needs a title.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await appFetchJson(`/api/app/trips/${tripId}/items`, {
        method: "POST",
        body: JSON.stringify({
          action: "create",
          title: cleanTitle,
          itemType,
          description: description.trim() || undefined,
          deadlineAt: time ? new Date(time).toISOString() : null,
        }),
      });
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add item");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add itinerary item</DialogTitle>
          <DialogDescription>
            Add a plan to this day without using AI suggestions.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="manual-item-title">Title</Label>
            <Input
              id="manual-item-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              autoFocus
            />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={itemType} onValueChange={setItemType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(TYPE_LABEL).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="manual-item-time">Time</Label>
              <Input
                id="manual-item-time"
                type="datetime-local"
                value={time}
                onChange={(event) => setTime(event.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="manual-item-description">Notes (optional)</Label>
            <Textarea
              id="manual-item-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={1000}
            />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={submitting}>
              Cancel
            </Button>
          </DialogClose>
          <Button onClick={() => void handleAdd()} disabled={submitting}>
            {submitting ? "Adding..." : "Add item"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddOptionDialog({
  tripId,
  itemId,
  onClose,
  onAdded,
}: {
  tripId: string;
  itemId: string;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [options, setOptions] = useState([
    { name: "", address: "", imageUrl: "", bookingUrl: "" },
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateOption(
    index: number,
    patch: Partial<(typeof options)[number]>
  ) {
    setOptions((current) =>
      current.map((option, i) =>
        i === index ? { ...option, ...patch } : option
      )
    );
  }

  function addRow() {
    if (options.length >= 10) return;
    setOptions((current) => [
      ...current,
      { name: "", address: "", imageUrl: "", bookingUrl: "" },
    ]);
  }

  function removeRow(index: number) {
    if (options.length <= 1) return;
    setOptions((current) => current.filter((_, i) => i !== index));
  }

  async function handleAdd() {
    const payload = options
      .map((option) => ({
        name: option.name.trim(),
        address: option.address.trim(),
        imageUrl: option.imageUrl.trim(),
        bookingUrl: option.bookingUrl.trim(),
      }))
      .filter((option) => option.name.length > 0);

    if (payload.length === 0) {
      setError("Enter at least one option.");
      return;
    }

    const names = new Set<string>();
    for (const option of payload) {
      const key = option.name.toLowerCase();
      if (names.has(key)) {
        setError("Option names must be unique.");
        return;
      }
      names.add(key);
    }

    setSubmitting(true);
    setError(null);
    try {
      for (const option of payload) {
        await appFetchJson(`/api/app/trips/${tripId}/items/${itemId}/options`, {
          method: "POST",
          body: JSON.stringify({
            name: option.name,
            address: option.address || undefined,
            imageUrl: option.imageUrl || undefined,
            bookingUrl: option.bookingUrl || undefined,
          }),
        });
      }
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add options");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add options</DialogTitle>
          <DialogDescription>
            Add one or more choices to this decision item.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
          {options.map((option, index) => (
            <div
              key={index}
              className="space-y-2 rounded-lg border border-[var(--border)] p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor={`it-option-name-${index}`}>
                  Option {index + 1}
                </Label>
                {options.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeRow(index)}
                    className="text-[11px] text-[var(--text-muted)] underline underline-offset-2 hover:text-[var(--foreground)]"
                  >
                    Remove
                  </button>
                )}
              </div>
              <Input
                id={`it-option-name-${index}`}
                value={option.name}
                onChange={(event) =>
                  updateOption(index, { name: event.target.value })
                }
                autoFocus={index === 0}
                placeholder="Name"
              />
              <Input
                value={option.address}
                onChange={(event) =>
                  updateOption(index, { address: event.target.value })
                }
                placeholder="Address (optional)"
              />
              <div className="grid gap-2 sm:grid-cols-2">
                <Input
                  value={option.imageUrl}
                  onChange={(event) =>
                    updateOption(index, { imageUrl: event.target.value })
                  }
                  placeholder="Image URL (optional)"
                />
                <Input
                  value={option.bookingUrl}
                  onChange={(event) =>
                    updateOption(index, { bookingUrl: event.target.value })
                  }
                  placeholder="Booking URL (optional)"
                />
              </div>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            className="h-8 w-full text-xs"
            onClick={addRow}
            disabled={options.length >= 10 || submitting}
          >
            Add more
          </Button>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={submitting}>
              Cancel
            </Button>
          </DialogClose>
          <Button onClick={() => void handleAdd()} disabled={submitting}>
            {submitting ? "Adding..." : "Add options"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

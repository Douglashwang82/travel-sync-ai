"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { appFetchJson } from "@/lib/app-client";
import { cn } from "@/lib/utils";
import type {
  ItineraryEntry,
  ItineraryResponse,
} from "@/app/api/app/trips/[tripId]/itinerary/route";
import type { AppMember } from "@/app/api/app/trips/[tripId]/members/route";
import type {
  DaySuggestion,
  SuggestDayResponse,
} from "@/app/api/app/trips/[tripId]/suggest-day/route";

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

const TYPE_PLACEHOLDER_BG: Record<string, string> = {
  hotel: "bg-blue-50 dark:bg-blue-950/40",
  restaurant: "bg-orange-50 dark:bg-orange-950/40",
  activity: "bg-emerald-50 dark:bg-emerald-950/40",
  transport: "bg-slate-100 dark:bg-slate-800/60",
  flight: "bg-sky-50 dark:bg-sky-950/40",
  insurance: "bg-violet-50 dark:bg-violet-950/40",
  other: "bg-[var(--secondary)]",
};

const STAGE_TONE: Record<string, string> = {
  confirmed: "bg-[#dcfce7] text-[#166534] dark:bg-[#14532d] dark:text-[#86efac]",
  pending: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  todo: "bg-[var(--secondary)] text-[var(--muted-foreground)]",
};

const UNASSIGNED = "__unassigned__";

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

function dayLabel(dateStr: string): string {
  return new Date(dateStr + "T00:00:00").toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

type DayEntry =
  | { key: string; label: string; items: ItineraryEntry[]; types: string[]; isEmpty: false }
  | { key: string; label: string; items: []; types: []; isEmpty: true };

export function TripItineraryClient({ tripId }: { tripId: string }) {
  const [data, setData] = useState<ItineraryResponse | null>(null);
  const [members, setMembers] = useState<AppMember[]>([]);
  const [role, setRole] = useState<"organizer" | "member">("member");
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "confirmed" | "pending" | "todo">(
    "confirmed"
  );

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

  const allDays = useMemo((): DayEntry[] => {
    if (!data) return [];

    // Grouped days for the current filter
    const filtered = data.items.filter((i) =>
      filter === "all" ? true : i.stage === filter
    );
    const itemDays: DayEntry[] = groupByDay(filtered).map((d) => ({
      ...d,
      isEmpty: false as const,
    }));

    if (!data.trip.start_date || !data.trip.end_date) return itemDays;

    // Dates in the trip range that have zero items scheduled (any stage)
    const occupiedKeys = new Set(
      data.items
        .filter((i) => i.deadline_at)
        .map((i) => new Date(i.deadline_at!).toISOString().split("T")[0])
    );
    const itemDayKeys = new Set(itemDays.map((d) => d.key));

    const emptyDays: DayEntry[] = generateDateRange(
      data.trip.start_date,
      data.trip.end_date
    )
      .filter((date) => !occupiedKeys.has(date) && !itemDayKeys.has(date))
      .map((date) => ({
        key: date,
        label: dayLabel(date),
        items: [] as [],
        types: [] as [],
        isEmpty: true as const,
      }));

    return [...itemDays, ...emptyDays].sort((a, b) => a.key.localeCompare(b.key));
  }, [data, filter]);

  if (error) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
        {error}{" "}
        <button
          type="button"
          onClick={() => void load()}
          className="ml-2 underline underline-offset-2"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!data) {
    return <div className="h-64 animate-pulse rounded-2xl bg-[var(--secondary)]" />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Itinerary</h2>
          <p className="text-xs text-[var(--muted-foreground)]">
            Everything with a deadline, ordered by day.
          </p>
        </div>
        <div className="flex rounded-full border border-[var(--border)] p-0.5 text-xs">
          {(["confirmed", "pending", "todo", "all"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={cn(
                "rounded-full px-3 py-1 font-medium capitalize transition-colors",
                filter === f
                  ? "bg-[var(--foreground)] text-[var(--background)]"
                  : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              )}
            >
              {f === "pending" ? "Pending vote" : f}
            </button>
          ))}
        </div>
      </div>

      {allDays.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--background)] px-6 py-10 text-center text-sm text-[var(--muted-foreground)]">
          Nothing to show for this filter yet.
        </div>
      ) : (
        <div className="space-y-8">
          {allDays.map((day) => (
            <section key={day.key} className="space-y-3">
              {day.isEmpty ? (
                <>
                  <DayDivider label={day.label} />
                  <EmptyDaySection
                    date={day.key}
                    tripId={tripId}
                    isOrganizer={role === "organizer"}
                    onAdded={() => void load()}
                  />
                </>
              ) : (
                <>
                  <div className="space-y-2">
                    <DayDivider label={day.label} />
                    <div className="flex flex-wrap justify-center gap-1.5">
                      {day.types.map((type) => (
                        <span
                          key={type}
                          className="rounded-full bg-[var(--secondary)] px-2.5 py-0.5 text-[10px] font-medium text-[var(--muted-foreground)]"
                        >
                          {TYPE_ICON[type] ?? "📌"} {TYPE_LABEL[type] ?? "Item"}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-3">
                    {day.items.map((item) => (
                      <ItineraryRow
                        key={item.id}
                        item={item}
                        tripId={tripId}
                        members={members}
                        isOrganizer={role === "organizer"}
                        onUpdated={() => void load()}
                      />
                    ))}
                  </div>
                </>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function DayDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="h-px flex-1 bg-[var(--border)]" />
      <span className="rounded-full bg-[var(--background)] px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
        {label}
      </span>
      <div className="h-px flex-1 bg-[var(--border)]" />
    </div>
  );
}

function EmptyDaySection({
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
  const [phase, setPhase] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [suggestions, setSuggestions] = useState<DaySuggestion[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [addingTitle, setAddingTitle] = useState<string | null>(null);

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
      setErrorMsg(err instanceof Error ? err.message : "Failed to get suggestions");
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
        }),
      });
      onAdded();
    } catch {
      // leave suggestion visible so user can retry
    } finally {
      setAddingTitle(null);
    }
  }

  if (phase === "idle") {
    return (
      <button
        type="button"
        onClick={() => void handleSuggest()}
        className="group w-full space-y-2 rounded-2xl border border-dashed border-[var(--border)] px-5 py-4 text-left transition-colors hover:border-[var(--primary)]/50 hover:bg-[var(--secondary)]/40"
      >
        <div className="space-y-2">
          <div className="h-3 w-3/4 rounded-full bg-[var(--secondary)]" />
          <div className="h-3 w-1/2 rounded-full bg-[var(--secondary)]" />
          <div className="h-3 w-2/3 rounded-full bg-[var(--secondary)]" />
        </div>
        <p className="text-[11px] font-medium text-[var(--primary)] opacity-70 transition-opacity group-hover:opacity-100">
          ✨ Nothing planned — click to get AI suggestions
        </p>
      </button>
    );
  }

  if (phase === "loading") {
    return (
      <div className="space-y-2 rounded-2xl border border-[var(--border)] px-5 py-4">
        {[...Array(4)].map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-3 rounded-xl bg-[var(--secondary)] p-3 animate-pulse"
          >
            <div className="h-8 w-8 rounded-lg bg-[var(--border)]" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3 w-2/3 rounded-full bg-[var(--border)]" />
              <div className="h-2.5 w-1/2 rounded-full bg-[var(--border)]" />
            </div>
          </div>
        ))}
        <p className="pt-1 text-center text-[10px] text-[var(--muted-foreground)]">
          Getting AI suggestions…
        </p>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="rounded-2xl border border-dashed border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
        {errorMsg}{" "}
        <button
          type="button"
          onClick={() => void handleSuggest()}
          className="ml-1 underline underline-offset-2"
        >
          Retry
        </button>
      </div>
    );
  }

  // done
  return (
    <div className="space-y-2 rounded-2xl border border-[var(--border)] bg-[var(--background)] px-5 py-4">
      <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
        ✨ AI Suggestions
      </p>
      {suggestions.map((s) => (
        <div
          key={s.title}
          className="flex items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--secondary)]/40 p-3"
        >
          <span className="mt-0.5 text-xl">
            {TYPE_ICON[s.item_type] ?? TYPE_ICON.other}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium leading-snug">{s.title}</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--muted-foreground)]">
              {s.description}
            </p>
            {s.reason && (
              <p className="mt-0.5 text-[10px] italic text-[var(--muted-foreground)]/70">
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
              className="shrink-0 text-xs"
            >
              {addingTitle === s.title ? "Adding…" : "Add"}
            </Button>
          )}
        </div>
      ))}
      <div className="flex justify-end pt-1">
        <button
          type="button"
          onClick={() => void handleSuggest()}
          className="text-[10px] text-[var(--muted-foreground)] underline underline-offset-2 hover:text-[var(--foreground)]"
        >
          Refresh suggestions
        </button>
      </div>
    </div>
  );
}

function groupByDay(items: ItineraryEntry[]) {
  const buckets = new Map<
    string,
    { label: string; items: ItineraryEntry[]; typeSet: Set<string> }
  >();

  for (const item of items) {
    let key = "zzz-unscheduled";
    let label = "Unscheduled";
    if (item.deadline_at) {
      const d = new Date(item.deadline_at);
      key = d.toISOString().split("T")[0];
      label = d.toLocaleDateString(undefined, {
        weekday: "long",
        month: "short",
        day: "numeric",
      });
    }
    if (!buckets.has(key)) buckets.set(key, { label, items: [], typeSet: new Set() });
    const bucket = buckets.get(key)!;
    bucket.items.push(item);
    bucket.typeSet.add(item.item_type);
  }

  return Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, { label, items, typeSet }]) => ({
      key,
      label,
      items,
      types: Array.from(typeSet),
    }));
}

function ItineraryRow({
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
  const [assignee, setAssignee] = useState(item.assigned_to_line_user_id ?? UNASSIGNED);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setError(null);
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
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  const option = item.confirmed_option;
  const assigneeName = item.assigned_to_line_user_id
    ? (members.find((m) => m.lineUserId === item.assigned_to_line_user_id)?.displayName ??
      item.assigned_to_line_user_id)
    : null;

  return (
    <article className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--background)]">
      {option?.image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={option.image_url}
          alt={option.name}
          className="h-44 w-full object-cover"
          loading="lazy"
        />
      ) : (
        <div
          className={cn(
            "flex h-20 w-full items-center justify-center gap-2",
            TYPE_PLACEHOLDER_BG[item.item_type] ?? TYPE_PLACEHOLDER_BG.other
          )}
        >
          <span className="text-2xl">{TYPE_ICON[item.item_type] ?? TYPE_ICON.other}</span>
          <span className="text-xs font-medium text-[var(--muted-foreground)]">
            {TYPE_LABEL[item.item_type] ?? "Item"}
          </span>
        </div>
      )}

      <div className="space-y-3 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className="text-[10px] uppercase">
                {TYPE_LABEL[item.item_type] ?? "Item"}
              </Badge>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize",
                  STAGE_TONE[item.stage] ?? STAGE_TONE.todo
                )}
              >
                {item.stage === "pending" ? "pending vote" : item.stage}
              </span>
              {item.booking_status === "needed" && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                  Book
                </span>
              )}
              {item.booking_status === "booked" && (
                <span className="rounded-full bg-[#dcfce7] px-2 py-0.5 text-[10px] font-semibold text-[#166534] dark:bg-[#14532d] dark:text-[#86efac]">
                  ✓ Booked
                </span>
              )}
            </div>

            <p className="mt-1.5 text-base font-semibold leading-snug">{item.title}</p>
            {option && option.name !== item.title && (
              <p className="text-xs text-[var(--muted-foreground)]">{option.name}</p>
            )}
            {item.description && (
              <p className="mt-1 text-xs leading-relaxed text-[var(--muted-foreground)]">
                {item.description}
              </p>
            )}
            {option?.address && (
              <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                📍 {option.address}
              </p>
            )}
          </div>

          <div className="flex flex-col items-end gap-1 text-right text-xs text-[var(--muted-foreground)]">
            {item.deadline_at && (
              <span className="rounded-full bg-[var(--secondary)] px-2 py-0.5 font-medium">
                {new Date(item.deadline_at).toLocaleTimeString(undefined, {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            )}
            {assigneeName && (
              <span className="rounded-full bg-blue-100 px-2 py-0.5 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                {assigneeName}
              </span>
            )}
          </div>
        </div>

        {(option?.booking_url || option?.google_maps_url || option?.rating) && (
          <div className="flex flex-wrap items-center gap-3 text-xs">
            {option?.rating && (
              <span className="text-[var(--muted-foreground)]">★ {option.rating}</span>
            )}
            {option?.price_level && (
              <span className="text-[var(--muted-foreground)]">{option.price_level}</span>
            )}
            {option?.google_maps_url && (
              <a
                href={option.google_maps_url}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-[var(--primary)] underline underline-offset-2"
              >
                Open in Maps
              </a>
            )}
            {option?.booking_url && (
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
          <div className="border-t border-[var(--border)] pt-3">
            {editing ? (
              <div className="space-y-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor={`it-deadline-${item.id}`} className="text-xs">
                      Deadline / time
                    </Label>
                    <Input
                      id={`it-deadline-${item.id}`}
                      type="datetime-local"
                      value={deadline}
                      onChange={(e) => setDeadline(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Assigned to</Label>
                    <Select value={assignee} onValueChange={setAssignee}>
                      <SelectTrigger>
                        <SelectValue placeholder="Unassigned" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                        {members.map((m) => (
                          <SelectItem key={m.lineUserId} value={m.lineUserId}>
                            {m.displayName ?? m.lineUserId}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {error && <p className="text-xs text-destructive">{error}</p>}
                <div className="flex justify-end gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setEditing(false);
                      setDeadline(toInputLocal(item.deadline_at));
                      setAssignee(item.assigned_to_line_user_id ?? UNASSIGNED);
                      setError(null);
                    }}
                    disabled={saving}
                  >
                    Cancel
                  </Button>
                  <Button size="sm" onClick={() => void handleSave()} disabled={saving}>
                    {saving ? "Saving…" : "Save"}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex justify-end">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setEditing(true)}
                  className="text-xs"
                >
                  Edit deadline / assignment
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

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

const TYPE_LABEL: Record<string, string> = {
  hotel: "Hotel",
  restaurant: "Food",
  activity: "Activity",
  transport: "Transport",
  flight: "Flight",
  insurance: "Insurance",
  other: "Item",
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

  const grouped = useMemo(() => {
    if (!data) return [];
    const filtered = data.items.filter((i) =>
      filter === "all" ? true : i.stage === filter
    );
    return groupByDay(filtered);
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

      {grouped.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--background)] px-6 py-10 text-center text-sm text-[var(--muted-foreground)]">
          Nothing to show for this filter yet.
        </div>
      ) : (
        <div className="space-y-8">
          {grouped.map((day) => (
            <section key={day.key} className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="h-px flex-1 bg-[var(--border)]" />
                <span className="rounded-full bg-[var(--background)] px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                  {day.label}
                </span>
                <div className="h-px flex-1 bg-[var(--border)]" />
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
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function groupByDay(items: ItineraryEntry[]) {
  const buckets = new Map<string, { label: string; items: ItineraryEntry[] }>();

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
    if (!buckets.has(key)) buckets.set(key, { label, items: [] });
    buckets.get(key)!.items.push(item);
  }

  return Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, v]) => ({ key, ...v }));
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
      {option?.image_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={option.image_url}
          alt={option.name}
          className="h-40 w-full object-cover"
        />
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
                    {saving ? "Saving..." : "Save"}
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

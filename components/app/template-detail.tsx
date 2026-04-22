"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { appFetchJson } from "@/lib/app-client";
import type { TripTemplate, TripTemplateVersion, TripTemplateItem } from "@/lib/types";

interface UserGroup {
  id: string;
  name: string | null;
  line_group_id: string;
  role: string;
}

interface TemplateData {
  template: TripTemplate;
  version: TripTemplateVersion;
  items: TripTemplateItem[];
}

export function TemplateDetailClient({ slug }: { slug: string }) {
  const [data, setData] = useState<TemplateData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [forkOpen, setForkOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await appFetchJson<TemplateData>(`/api/app/templates/${slug}`);
      setData(res);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load template");
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loadError) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
        {loadError}
      </div>
    );
  }

  if (!data) {
    return <div className="h-64 animate-pulse rounded-2xl bg-[var(--secondary)]" />;
  }

  const { template, version, items } = data;
  const byDay = groupByDay(items);
  const days = [...byDay.keys()].sort((a, b) => a - b);

  return (
    <div className="space-y-6">
      <nav className="text-xs text-[var(--muted-foreground)]">
        <Link href="/app/templates" className="hover:text-[var(--foreground)]">
          Templates
        </Link>
        <span className="mx-1.5">/</span>
        <span className="text-[var(--foreground)]">{version.title}</span>
      </nav>

      {version.cover_image_url && (
        <div className="aspect-[3/1] overflow-hidden rounded-2xl">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={version.cover_image_url}
            alt={version.title}
            className="h-full w-full object-cover"
          />
        </div>
      )}

      <header className="rounded-2xl border border-[var(--border)] bg-[var(--background)] p-5 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1.5 min-w-0">
            <div className="flex flex-wrap gap-2 text-[11px]">
              <span className="rounded-full bg-[var(--secondary)] px-2 py-0.5 font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                {version.destination_name}
              </span>
              <span className="rounded-full bg-[var(--secondary)] px-2 py-0.5 font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                {version.duration_days} {version.duration_days === 1 ? "day" : "days"}
              </span>
              {version.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[var(--muted-foreground)]"
                >
                  {tag}
                </span>
              ))}
            </div>
            <h1 className="text-2xl font-bold text-[var(--foreground)] sm:text-3xl">
              {version.title}
            </h1>
            {version.summary && (
              <p className="text-sm text-[var(--muted-foreground)]">{version.summary}</p>
            )}
          </div>
          <Button onClick={() => setForkOpen(true)} className="shrink-0">
            Use this template
          </Button>
        </div>

        <div className="flex flex-wrap gap-4 text-xs text-[var(--muted-foreground)] border-t border-[var(--border)] pt-3">
          <span>{template.fork_count} {template.fork_count === 1 ? "fork" : "forks"}</span>
          <span>{template.like_count} {template.like_count === 1 ? "like" : "likes"}</span>
          <span>v{version.version_number}</span>
          <span>Published {formatDate(version.published_at)}</span>
        </div>
      </header>

      <section className="space-y-4">
        <h2 className="text-base font-semibold">Itinerary</h2>
        {days.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)]">No items in this template yet.</p>
        ) : (
          days.map((day) => (
            <DaySection key={day} day={day} items={byDay.get(day) ?? []} />
          ))
        )}
      </section>

      {forkOpen && (
        <ForkModal
          slug={slug}
          templateTitle={version.title}
          durationDays={version.duration_days}
          onClose={() => setForkOpen(false)}
        />
      )}
    </div>
  );
}

function DaySection({ day, items }: { day: number; items: TripTemplateItem[] }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--background)] overflow-hidden">
      <div className="border-b border-[var(--border)] bg-[var(--secondary)]/40 px-5 py-2.5">
        <h3 className="text-sm font-semibold">Day {day}</h3>
      </div>
      <ul className="divide-y divide-[var(--border)]">
        {items.map((item) => (
          <li key={item.id} className="px-5 py-3 space-y-0.5">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium">{item.title}</span>
              <span className="shrink-0 rounded-full bg-[var(--secondary)] px-2 py-0.5 text-[11px] font-medium capitalize text-[var(--muted-foreground)]">
                {item.item_type}
              </span>
            </div>
            {item.notes && (
              <p className="text-xs text-[var(--muted-foreground)]">{item.notes}</p>
            )}
            {item.place_name && (
              <p className="text-xs text-[var(--muted-foreground)]">
                {item.place_name}
                {item.address ? ` · ${item.address}` : ""}
              </p>
            )}
            {item.external_url && (
              <a
                href={item.external_url}
                target="_blank"
                rel="noreferrer"
                className="text-[11px] text-[var(--primary)] underline underline-offset-2"
              >
                More info
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ForkModal({
  slug,
  templateTitle,
  durationDays,
  onClose,
}: {
  slug: string;
  templateTitle: string;
  durationDays: number;
  onClose: () => void;
}) {
  const router = useRouter();
  const [groups, setGroups] = useState<UserGroup[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(true);
  const [groupId, setGroupId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    appFetchJson<{ groups: UserGroup[] }>("/api/app/me/groups")
      .then((res) => {
        setGroups(res.groups);
        if (res.groups.length === 1) setGroupId(res.groups[0].id);
      })
      .catch(() => setError("Failed to load your groups"))
      .finally(() => setGroupsLoading(false));
  }, []);

  async function handleFork() {
    if (!groupId || !startDate) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await appFetchJson<{ tripId: string }>(
        `/api/app/templates/${slug}/fork`,
        {
          method: "POST",
          body: JSON.stringify({ groupId, startDate }),
        }
      );
      router.push(`/app/trips/${res.tripId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create trip");
      setSubmitting(false);
    }
  }

  const endDate = startDate
    ? computeEndDate(startDate, durationDays)
    : null;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Use template</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <p className="text-sm text-[var(--muted-foreground)]">
            Creating a trip from <span className="font-medium text-[var(--foreground)]">{templateTitle}</span> ({durationDays} {durationDays === 1 ? "day" : "days"}).
          </p>

          <div className="space-y-1.5">
            <Label>Trip group</Label>
            {groupsLoading ? (
              <div className="h-9 animate-pulse rounded-md bg-[var(--secondary)]" />
            ) : groups.length === 0 ? (
              <p className="text-xs text-[var(--muted-foreground)]">
                No groups found. Join a LINE group and add the TravelSync bot first.
              </p>
            ) : (
              <Select value={groupId} onValueChange={setGroupId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a group" />
                </SelectTrigger>
                <SelectContent>
                  {groups.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.name ?? g.line_group_id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="fork-start-date">Start date</Label>
            <Input
              id="fork-start-date"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
            {endDate && (
              <p className="text-[11px] text-[var(--muted-foreground)]">
                Trip will end on {endDate}
              </p>
            )}
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            onClick={() => void handleFork()}
            disabled={submitting || !groupId || !startDate}
          >
            {submitting ? "Creating trip…" : "Create trip"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function groupByDay(items: TripTemplateItem[]): Map<number, TripTemplateItem[]> {
  const map = new Map<number, TripTemplateItem[]>();
  for (const item of items) {
    const list = map.get(item.day_number) ?? [];
    list.push(item);
    map.set(item.day_number, list);
  }
  return map;
}

function computeEndDate(startDate: string, durationDays: number): string {
  const d = new Date(startDate + "T00:00:00");
  d.setDate(d.getDate() + durationDays - 1);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

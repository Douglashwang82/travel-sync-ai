"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  EmptyState,
  ErrorScreen,
  InlineError,
  ListSkeleton,
  LoadingSpinner,
} from "@/components/liff/shared";
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
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { liffFetch } from "@/lib/liff-client";
import { toLiffErrorMessage } from "@/lib/liff-errors";
import { useLiffSession } from "@/lib/use-liff-session";
import { cn } from "@/lib/utils";
import type {
  PackCategory,
  PackItem,
  PackListResponse,
} from "@/app/api/liff/pack/route";

const CATEGORIES: { value: PackCategory; label: string; emoji: string }[] = [
  { value: "documents", label: "Documents", emoji: "📄" },
  { value: "clothing", label: "Clothing", emoji: "👕" },
  { value: "toiletries", label: "Toiletries", emoji: "🧴" },
  { value: "electronics", label: "Electronics", emoji: "🔌" },
  { value: "health", label: "Health", emoji: "💊" },
  { value: "general", label: "General", emoji: "🎒" },
];

const CATEGORY_META = Object.fromEntries(
  CATEGORIES.map((c) => [c.value, c])
) as Record<PackCategory, (typeof CATEGORIES)[number]>;

// Curated starter suggestions to make the empty state useful with one tap.
const STARTER_SUGGESTIONS: { label: string; category: PackCategory }[] = [
  { label: "Passport", category: "documents" },
  { label: "Boarding pass", category: "documents" },
  { label: "Travel insurance", category: "documents" },
  { label: "Phone charger", category: "electronics" },
  { label: "Power adapter", category: "electronics" },
  { label: "Headphones", category: "electronics" },
  { label: "Toothbrush & toothpaste", category: "toiletries" },
  { label: "Sunscreen", category: "toiletries" },
  { label: "Underwear", category: "clothing" },
  { label: "Socks", category: "clothing" },
  { label: "Comfortable walking shoes", category: "clothing" },
  { label: "Daily medication", category: "health" },
  { label: "Wallet & cash", category: "general" },
];

export default function PackPage() {
  const {
    isReady,
    isLoggedIn,
    error,
    session,
    sessionLoading,
    sessionError,
    reloadSession,
  } = useLiffSession();
  const [data, setData] = useState<PackListResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newCategory, setNewCategory] = useState<PackCategory>("general");
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const tripId = session?.activeTrip?.id ?? null;

  const fetchList = useCallback(
    async (id: string) => {
      const res = await liffFetch(`/api/liff/pack?tripId=${encodeURIComponent(id)}`);
      if (!res.ok) {
        throw new Error("Failed to load packing list");
      }
      const body = (await res.json()) as PackListResponse;
      setData(body);
    },
    []
  );

  const reload = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const sessionData = await reloadSession();
      if (!sessionData) throw new Error("Failed to load session");
      if (!sessionData.activeTrip) {
        setData(null);
        return;
      }
      await fetchList(sessionData.activeTrip.id);
    } catch (err) {
      setLoadError(
        toLiffErrorMessage(
          "pack",
          err,
          "We could not load your packing list. Reopen this page in LINE and try again."
        )
      );
    } finally {
      setLoading(false);
    }
  }, [reloadSession, fetchList]);

  useEffect(() => {
    if (!isReady || !isLoggedIn || !session || sessionLoading) return;
    if (!session.activeTrip) {
      setData(null);
      return;
    }
    void (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        await fetchList(session.activeTrip!.id);
      } catch (err) {
        setLoadError(
          toLiffErrorMessage(
            "pack",
            err,
            "We could not load your packing list. Reopen this page in LINE and try again."
          )
        );
      } finally {
        setLoading(false);
      }
    })();
  }, [isReady, isLoggedIn, session, sessionLoading, fetchList]);

  async function addItem(label: string, category: PackCategory) {
    if (!tripId) return;
    setSubmitting(true);
    setActionError(null);
    try {
      const res = await liffFetch("/api/liff/pack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tripId, label, category }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(err?.error ?? "Failed to add item");
      }
      const created = (await res.json()) as PackItem;
      setData((prev) =>
        prev
          ? {
              ...prev,
              items: [...prev.items, created],
              totalCount: prev.totalCount + 1,
            }
          : prev
      );
    } catch (err) {
      setActionError(
        toLiffErrorMessage("pack-add", err, "We could not add that item. Try again.")
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAddFromSheet() {
    const label = newLabel.trim();
    if (!label) {
      setActionError("Enter what you want to pack.");
      return;
    }
    await addItem(label, newCategory);
    if (!actionError) {
      setNewLabel("");
      setNewCategory("general");
      setAddOpen(false);
    }
  }

  async function togglePacked(item: PackItem) {
    const nextPacked = !item.isPacked;

    // Optimistic update
    setData((prev) =>
      prev
        ? {
            ...prev,
            items: prev.items.map((it) =>
              it.id === item.id
                ? {
                    ...it,
                    isPacked: nextPacked,
                    packedAt: nextPacked ? new Date().toISOString() : null,
                  }
                : it
            ),
            packedCount: prev.packedCount + (nextPacked ? 1 : -1),
          }
        : prev
    );

    try {
      const res = await liffFetch(`/api/liff/pack/${encodeURIComponent(item.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPacked: nextPacked }),
      });
      if (!res.ok) throw new Error("Failed to update item");
    } catch (err) {
      setActionError(
        toLiffErrorMessage("pack-toggle", err, "Could not save your change. Reloading.")
      );
      void reload();
    }
  }

  async function deleteItem(item: PackItem) {
    const previousData = data;
    setData((prev) =>
      prev
        ? {
            ...prev,
            items: prev.items.filter((it) => it.id !== item.id),
            totalCount: prev.totalCount - 1,
            packedCount: item.isPacked ? prev.packedCount - 1 : prev.packedCount,
          }
        : prev
    );
    try {
      const res = await liffFetch(`/api/liff/pack/${encodeURIComponent(item.id)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete item");
    } catch (err) {
      setActionError(
        toLiffErrorMessage("pack-delete", err, "Could not delete that item.")
      );
      setData(previousData);
    }
  }

  const grouped = useMemo(() => {
    if (!data) return [] as { category: PackCategory; items: PackItem[] }[];
    const buckets = new Map<PackCategory, PackItem[]>();
    for (const cat of CATEGORIES) buckets.set(cat.value, []);
    for (const it of data.items) {
      const list = buckets.get(it.category) ?? buckets.get("general")!;
      list.push(it);
    }
    return CATEGORIES.filter((c) => (buckets.get(c.value) ?? []).length > 0).map((c) => ({
      category: c.value,
      items: buckets.get(c.value)!,
    }));
  }, [data]);

  if (!isReady) return <LoadingSpinner message="Initializing..." />;
  if (error) return <ErrorScreen message={error} />;
  if (!isLoggedIn) return <LoadingSpinner message="Logging in..." />;
  if (sessionLoading && !session) return <ListSkeleton rows={5} />;
  if (sessionError && !session)
    return <ErrorScreen message={sessionError} onRetry={reload} />;
  if (loading) return <ListSkeleton rows={5} />;
  if (loadError) return <ErrorScreen message={loadError} onRetry={reload} />;

  if (!session?.activeTrip) {
    return (
      <EmptyState
        emoji="🎒"
        title="No active trip yet"
        description="Start a trip from the dashboard, then come back to build your private packing list."
      />
    );
  }

  const completion = data && data.totalCount > 0
    ? Math.round((data.packedCount / data.totalCount) * 100)
    : 0;
  const daysLeft = computeDaysUntil(data?.startDate ?? session.activeTrip.start_date);

  return (
    <div className="mx-auto max-w-md">
      <div className="sticky top-0 z-10 border-b border-[var(--border)] bg-[var(--background)]/95 px-4 py-3 backdrop-blur-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
              Pack
            </p>
            <h1 className="mt-1 truncate text-base font-bold">
              {data?.destinationName ?? session.activeTrip.destination_name ?? "Your trip"}
            </h1>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">
              {formatCountdown(daysLeft, data?.startDate ?? session.activeTrip.start_date)}
            </p>
          </div>
          <Button size="sm" onClick={() => setAddOpen(true)}>
            + Add
          </Button>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <Badge
            variant="secondary"
            className="rounded-full bg-[var(--secondary)] text-[var(--secondary-foreground)]"
          >
            🔒 Private to you
          </Badge>
        </div>
      </div>

      {actionError ? (
        <InlineError message={actionError} onDismiss={() => setActionError(null)} />
      ) : null}

      <div className="space-y-4 px-4 pb-6 pt-4">
        <ProgressCard
          packed={data?.packedCount ?? 0}
          total={data?.totalCount ?? 0}
          completion={completion}
          daysLeft={daysLeft}
        />

        {data && data.items.length === 0 ? (
          <StarterSuggestions onAdd={addItem} disabled={submitting} />
        ) : (
          <div className="space-y-4">
            {grouped.map((group) => (
              <CategorySection
                key={group.category}
                category={group.category}
                items={group.items}
                onToggle={togglePacked}
                onDelete={deleteItem}
              />
            ))}
          </div>
        )}

        <p className="px-1 text-[11px] leading-relaxed text-[var(--muted-foreground)]">
          Only you can see this list. It is not shared with the trip group.
        </p>
      </div>

      <Sheet
        open={addOpen}
        onOpenChange={(open) => {
          setAddOpen(open);
          if (!open) setActionError(null);
        }}
      >
        <SheetContent side="bottom" className="rounded-t-2xl">
          <SheetHeader className="mb-4">
            <SheetTitle>Add to your pack list</SheetTitle>
          </SheetHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="pack-label">Item</Label>
              <Input
                id="pack-label"
                placeholder="e.g. Rain jacket"
                value={newLabel}
                maxLength={120}
                autoFocus
                onChange={(e) => setNewLabel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !submitting) {
                    e.preventDefault();
                    void handleAddFromSheet();
                  }
                }}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="pack-category">Category</Label>
              <Select
                value={newCategory}
                onValueChange={(value) => setNewCategory(value as PackCategory)}
              >
                <SelectTrigger id="pack-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      <span className="mr-2">{c.emoji}</span>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {actionError ? (
              <p className="text-xs text-[var(--destructive)]">{actionError}</p>
            ) : null}

            <Button
              className="w-full"
              disabled={submitting || !newLabel.trim()}
              onClick={() => void handleAddFromSheet()}
            >
              {submitting ? "Adding..." : "Add item"}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function ProgressCard({
  packed,
  total,
  completion,
  daysLeft,
}: {
  packed: number;
  total: number;
  completion: number;
  daysLeft: number | null;
}) {
  const remaining = Math.max(0, total - packed);
  return (
    <section className="rounded-2xl bg-[var(--primary)] p-5 text-white">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium opacity-80">Packed</p>
          <p className="mt-1 text-3xl font-bold">{completion}%</p>
          <p className="mt-1 text-xs opacity-80">
            {packed} of {total} item{total === 1 ? "" : "s"}
            {remaining > 0 ? ` · ${remaining} to go` : total > 0 ? " · all set" : ""}
          </p>
        </div>
        {daysLeft !== null ? (
          <div className="text-right">
            <p className="text-xs opacity-80">Trip starts in</p>
            <p className="mt-1 text-2xl font-semibold">
              {daysLeft <= 0 ? "Today" : `${daysLeft}d`}
            </p>
          </div>
        ) : null}
      </div>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/20">
        <div
          className="h-full rounded-full bg-white transition-all"
          style={{ width: `${Math.max(0, Math.min(100, completion))}%` }}
        />
      </div>
    </section>
  );
}

function CategorySection({
  category,
  items,
  onToggle,
  onDelete,
}: {
  category: PackCategory;
  items: PackItem[];
  onToggle: (item: PackItem) => void;
  onDelete: (item: PackItem) => void;
}) {
  const meta = CATEGORY_META[category];
  const packed = items.filter((it) => it.isPacked).length;
  return (
    <section className="overflow-hidden rounded-2xl border border-[var(--border)]">
      <div className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--secondary)] px-4 py-2.5">
        <h2 className="text-sm font-medium">
          <span className="mr-2">{meta.emoji}</span>
          {meta.label}
        </h2>
        <span className="text-xs text-[var(--muted-foreground)]">
          {packed}/{items.length}
        </span>
      </div>
      <ul className="divide-y divide-[var(--border)]">
        {items.map((item) => (
          <PackRow key={item.id} item={item} onToggle={onToggle} onDelete={onDelete} />
        ))}
      </ul>
    </section>
  );
}

function PackRow({
  item,
  onToggle,
  onDelete,
}: {
  item: PackItem;
  onToggle: (item: PackItem) => void;
  onDelete: (item: PackItem) => void;
}) {
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <button
        type="button"
        onClick={() => onToggle(item)}
        aria-pressed={item.isPacked}
        aria-label={item.isPacked ? `Mark ${item.label} as not packed` : `Mark ${item.label} as packed`}
        className={cn(
          "flex h-6 w-6 shrink-0 items-center justify-center rounded-md border transition-colors",
          item.isPacked
            ? "border-[var(--primary)] bg-[var(--primary)] text-white"
            : "border-[var(--border)] bg-[var(--background)] hover:border-[var(--primary)]"
        )}
      >
        {item.isPacked ? (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="h-4 w-4"
            aria-hidden
          >
            <path
              fillRule="evenodd"
              d="M16.704 5.29a1 1 0 010 1.42l-7.5 7.5a1 1 0 01-1.42 0l-3.5-3.5a1 1 0 011.42-1.42l2.79 2.79 6.79-6.79a1 1 0 011.42 0z"
              clipRule="evenodd"
            />
          </svg>
        ) : null}
      </button>
      <button
        type="button"
        onClick={() => onToggle(item)}
        className="flex-1 min-w-0 text-left"
      >
        <p
          className={cn(
            "truncate text-sm",
            item.isPacked
              ? "text-[var(--muted-foreground)] line-through"
              : "text-[var(--foreground)]"
          )}
        >
          {item.label}
        </p>
      </button>
      <button
        type="button"
        onClick={() => onDelete(item)}
        aria-label={`Remove ${item.label}`}
        className="shrink-0 rounded-md p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)] hover:text-[var(--foreground)]"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          className="h-4 w-4"
          aria-hidden
        >
          <path
            fillRule="evenodd"
            d="M8.5 3.5A1.5 1.5 0 0110 2h0a1.5 1.5 0 011.5 1.5V4h3.25a.75.75 0 010 1.5H14l-.6 9.6a2 2 0 01-2 1.9H8.6a2 2 0 01-2-1.9L6 5.5H5.25a.75.75 0 010-1.5H8.5v-.5zm-.9 2L8.16 14.93a.5.5 0 00.5.47h2.68a.5.5 0 00.5-.47L12.4 5.5h-4.8z"
            clipRule="evenodd"
          />
        </svg>
      </button>
    </li>
  );
}

function StarterSuggestions({
  onAdd,
  disabled,
}: {
  onAdd: (label: string, category: PackCategory) => void;
  disabled: boolean;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-[var(--border)]">
      <div className="border-b border-[var(--border)] bg-[var(--secondary)] px-4 py-2.5">
        <h2 className="text-sm font-medium">Quick start</h2>
        <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
          Tap any suggestion to add it to your private list.
        </p>
      </div>
      <div className="flex flex-wrap gap-2 p-4">
        {STARTER_SUGGESTIONS.map((suggestion) => (
          <button
            key={`${suggestion.category}-${suggestion.label}`}
            type="button"
            disabled={disabled}
            onClick={() => onAdd(suggestion.label, suggestion.category)}
            className={cn(
              "rounded-full border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-xs font-medium",
              "transition-colors hover:border-[var(--primary)] hover:text-[var(--primary)]",
              "disabled:opacity-50"
            )}
          >
            <span className="mr-1.5">{CATEGORY_META[suggestion.category].emoji}</span>
            {suggestion.label}
          </button>
        ))}
      </div>
    </section>
  );
}

function computeDaysUntil(startDate: string | null | undefined): number | null {
  if (!startDate) return null;
  const start = new Date(`${startDate}T00:00:00`);
  if (Number.isNaN(start.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffMs = start.getTime() - today.getTime();
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

function formatCountdown(days: number | null, startDate: string | null | undefined): string {
  if (days === null) return "Trip start date not set yet";
  if (days < 0) return `Trip started ${Math.abs(days)}d ago`;
  if (days === 0) return "Trip starts today";
  if (days === 1) return "Trip starts tomorrow";
  if (startDate) return `${days} days until ${startDate}`;
  return `${days} days to go`;
}

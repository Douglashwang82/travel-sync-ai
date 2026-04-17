"use client";

import { useCallback, useEffect, useState } from "react";
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
import { liffFetch } from "@/lib/liff-client";
import { toLiffErrorMessage } from "@/lib/liff-errors";
import { useLiffSession } from "@/lib/use-liff-session";
import { cn } from "@/lib/utils";

type SourceType = "website" | "rss" | "instagram" | "threads" | "x" | "youtube" | "tiktok";
type Category = "travel" | "restaurant" | "attraction" | "event" | "other";

type TrackingList = {
  id: string;
  source_type: SourceType;
  source_url: string;
  display_name: string | null;
  category: Category;
  keywords: string[];
  region: string | null;
  is_active: boolean;
  frequency_hours: number;
  last_run_at: string | null;
  last_success_at: string | null;
  consecutive_failures: number;
};

type TrackingItem = {
  id: string;
  external_id: string | null;
  title: string;
  summary: string | null;
  url: string | null;
  category: Category | null;
  location: string | null;
  tags: string[];
  first_seen_at: string;
};

const SOURCE_OPTIONS: { value: SourceType; label: string; hint: string }[] = [
  { value: "website", label: "Website", hint: "Any blog or listing page" },
  { value: "rss", label: "RSS / Atom", hint: "Cheapest; most travel blogs expose one" },
  { value: "youtube", label: "YouTube", hint: "Channel URL (@handle, /channel/UC…, /c/, /user/)" },
  { value: "instagram", label: "Instagram", hint: "Coming soon" },
  { value: "threads", label: "Threads", hint: "Coming soon" },
  { value: "x", label: "X (Twitter)", hint: "Coming soon" },
  { value: "tiktok", label: "TikTok", hint: "Coming soon" },
];

const CATEGORY_OPTIONS: { value: Category; label: string }[] = [
  { value: "travel", label: "Travel" },
  { value: "restaurant", label: "Restaurant" },
  { value: "attraction", label: "Attraction" },
  { value: "event", label: "Event" },
  { value: "other", label: "Other" },
];

const CATEGORY_BADGE: Record<Category, string> = {
  travel: "bg-sky-100 text-sky-800",
  restaurant: "bg-amber-100 text-amber-800",
  attraction: "bg-emerald-100 text-emerald-800",
  event: "bg-fuchsia-100 text-fuchsia-800",
  other: "bg-slate-100 text-slate-700",
};

export default function TrackingPage() {
  const { isReady, isLoggedIn, error } = useLiffSession();
  const [lists, setLists] = useState<TrackingList[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [items, setItems] = useState<Record<string, TrackingItem[]>>({});
  const [pendingId, setPendingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await liffFetch("/api/liff/tracking");
      if (!res.ok) throw new Error("Failed to load");
      const data = (await res.json()) as { items: TrackingList[] };
      setLists(data.items);
    } catch (err) {
      setLoadError(
        toLiffErrorMessage("tracking", err, "We could not load your tracking list.")
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isReady && isLoggedIn) void load();
  }, [isReady, isLoggedIn, load]);

  async function handleCreate(input: CreateInput) {
    setInlineError(null);
    const res = await liffFetch("/api/liff/tracking", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "create", ...input }),
    });
    if (res.status === 409) {
      setInlineError("You're already tracking that URL.");
      return;
    }
    if (!res.ok) {
      setInlineError("Could not add source. Check the URL and try again.");
      return;
    }
    await load();
  }

  async function handleToggleActive(row: TrackingList) {
    setPendingId(row.id);
    try {
      await liffFetch("/api/liff/tracking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update", id: row.id, isActive: !row.is_active }),
      });
      await load();
    } finally {
      setPendingId(null);
    }
  }

  async function handleDelete(row: TrackingList) {
    if (!confirm(`Delete tracking for ${shortenUrl(row.source_url)}?`)) return;
    setPendingId(row.id);
    try {
      await liffFetch("/api/liff/tracking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", id: row.id }),
      });
      await load();
    } finally {
      setPendingId(null);
    }
  }

  async function handleRunNow(row: TrackingList) {
    setPendingId(row.id);
    setInlineError(null);
    try {
      const res = await liffFetch("/api/liff/tracking/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: row.id }),
      });
      if (!res.ok) {
        setInlineError("Run failed — check the source URL.");
        return;
      }
      const data = (await res.json()) as { items: TrackingItem[] };
      setItems((prev) => ({ ...prev, [row.id]: data.items }));
      setExpanded(row.id);
      await load();
    } finally {
      setPendingId(null);
    }
  }

  async function handleSendDigest() {
    setInlineError(null);
    const res = await liffFetch("/api/liff/tracking/digest", { method: "POST" });
    if (!res.ok) {
      setInlineError("Could not send digest right now.");
      return;
    }
    const data = (await res.json()) as { delivered: boolean; skipped_reason?: string; item_count: number };
    if (data.delivered) {
      setInlineError(`Digest sent (${data.item_count} items). Check your LINE chat with the bot.`);
    } else if (data.skipped_reason === "no_items") {
      setInlineError("No new items today — add a source and run it first.");
    } else if (data.skipped_reason === "already_sent") {
      setInlineError("Today's digest was already delivered.");
    } else {
      setInlineError("Digest could not be composed. Try again later.");
    }
  }

  // ─── Render gates ────────────────────────────────────────────────────────
  if (!isReady) return <LoadingSpinner message="Initializing..." />;
  if (error) return <ErrorScreen message={error} />;
  if (!isLoggedIn) return <LoadingSpinner message="Logging in..." />;
  if (loading && !lists) return <ListSkeleton rows={4} />;
  if (loadError) return <ErrorScreen message={loadError} onRetry={load} />;

  return (
    <div className="mx-auto w-full max-w-md">
      <header className="border-b border-[var(--border)] px-4 py-3">
        <h1 className="text-base font-semibold">Tracking List</h1>
        <p className="text-xs text-[var(--muted-foreground)]">
          Sources we check daily for travel & restaurant updates.
        </p>
      </header>

      <CreateForm onSubmit={handleCreate} />

      {inlineError ? (
        <InlineError message={inlineError} onDismiss={() => setInlineError(null)} />
      ) : null}

      {!lists || lists.length === 0 ? (
        <EmptyState
          emoji="📡"
          title="No sources yet"
          description="Add a travel blog, restaurant guide, or RSS feed above and we'll check it daily."
        />
      ) : (
        <ul className="divide-y divide-[var(--border)] px-4">
          {lists.map((row) => (
            <li key={row.id} className="py-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge className={cn("text-[10px]", CATEGORY_BADGE[row.category])}>
                      {row.category}
                    </Badge>
                    <Badge variant="outline" className="text-[10px]">
                      {row.source_type}
                    </Badge>
                    {!row.is_active ? (
                      <Badge variant="outline" className="text-[10px] text-slate-500">
                        paused
                      </Badge>
                    ) : null}
                    {row.consecutive_failures > 0 ? (
                      <Badge variant="outline" className="text-[10px] text-red-600">
                        {row.consecutive_failures} failed
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mt-1 truncate text-sm font-medium">
                    {row.display_name ?? shortenUrl(row.source_url)}
                  </p>
                  <p className="truncate text-xs text-[var(--muted-foreground)]">
                    {row.source_url}
                  </p>
                  <p className="mt-1 text-[11px] text-[var(--muted-foreground)]">
                    {row.last_success_at
                      ? `Last items: ${relativeTime(row.last_success_at)}`
                      : "Never run"}
                  </p>
                </div>
              </div>

              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="default"
                  disabled={pendingId === row.id}
                  onClick={() => void handleRunNow(row)}
                >
                  Run now
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pendingId === row.id}
                  onClick={() => void handleToggleActive(row)}
                >
                  {row.is_active ? "Pause" : "Resume"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pendingId === row.id}
                  onClick={() => void handleDelete(row)}
                >
                  Delete
                </Button>
                {items[row.id]?.length ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setExpanded(expanded === row.id ? null : row.id)}
                  >
                    {expanded === row.id ? "Hide items" : `Show items (${items[row.id].length})`}
                  </Button>
                ) : null}
              </div>

              {expanded === row.id && items[row.id]?.length ? (
                <ul className="mt-3 space-y-2 rounded-xl bg-[var(--secondary)] p-3">
                  {items[row.id].slice(0, 10).map((it) => (
                    <li key={it.id} className="text-xs">
                      <p className="font-medium">{it.title}</p>
                      {it.summary ? (
                        <p className="text-[var(--muted-foreground)]">{it.summary}</p>
                      ) : null}
                      {it.url ? (
                        <a
                          href={it.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[10px] text-[var(--primary)] underline"
                        >
                          {shortenUrl(it.url)}
                        </a>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {lists && lists.length > 0 ? (
        <div className="border-t border-[var(--border)] px-4 py-3">
          <Button variant="outline" size="sm" onClick={() => void handleSendDigest()}>
            Send today's digest to LINE
          </Button>
        </div>
      ) : null}
    </div>
  );
}

// ─── CreateForm ────────────────────────────────────────────────────────────

type CreateInput = {
  sourceType: SourceType;
  sourceUrl: string;
  category: Category;
  region?: string;
};

function CreateForm({ onSubmit }: { onSubmit: (i: CreateInput) => Promise<void> }) {
  const [sourceType, setSourceType] = useState<SourceType>("website");
  const [sourceUrl, setSourceUrl] = useState("");
  const [category, setCategory] = useState<Category>("travel");
  const [region, setRegion] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const mvpUnsupported =
    sourceType !== "website" && sourceType !== "rss" && sourceType !== "youtube";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!sourceUrl.trim() || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit({
        sourceType,
        sourceUrl: sourceUrl.trim(),
        category,
        region: region.trim() || undefined,
      });
      setSourceUrl("");
      setRegion("");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="space-y-3 border-b border-[var(--border)] px-4 py-3" onSubmit={submit}>
      <div className="space-y-1.5">
        <Label htmlFor="trk-url">URL</Label>
        <Input
          id="trk-url"
          type="url"
          placeholder="https://…"
          value={sourceUrl}
          onChange={(e) => setSourceUrl(e.target.value)}
          required
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <Label>Source</Label>
          <Select value={sourceType} onValueChange={(v) => setSourceType(v as SourceType)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {SOURCE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Category</Label>
          <Select value={category} onValueChange={(v) => setCategory(v as Category)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {CATEGORY_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="trk-region">Region (optional)</Label>
        <Input
          id="trk-region"
          placeholder="Tokyo, 台北 …"
          value={region}
          onChange={(e) => setRegion(e.target.value)}
        />
      </div>
      {mvpUnsupported ? (
        <p className="text-[11px] text-amber-700">
          {SOURCE_OPTIONS.find((o) => o.value === sourceType)?.label} is not wired up yet —
          Website, RSS, and YouTube work today.
        </p>
      ) : null}
      <Button type="submit" disabled={submitting || mvpUnsupported || !sourceUrl.trim()}>
        {submitting ? "Adding…" : "Add source"}
      </Button>
    </form>
  );
}

// ─── Utils ──────────────────────────────────────────────────────────────────

function shortenUrl(u: string): string {
  try {
    const url = new URL(u);
    return url.host + (url.pathname === "/" ? "" : url.pathname).slice(0, 40);
  } catch {
    return u.slice(0, 50);
  }
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diffMs = Date.now() - then;
  const mins = Math.round(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

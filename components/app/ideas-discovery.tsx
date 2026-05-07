"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
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
import type { ItemType } from "@/lib/types";

type SortOrder = "recent" | "popular";

interface Idea {
  id: string;
  title: string;
  notes: string | null;
  itemType: ItemType;
  placeName: string | null;
  address: string | null;
  externalUrl: string | null;
  durationMinutes: number | null;
  destinationName: string;
  templateSlug: string;
  templateTitle: string;
  templateCoverImageUrl: string | null;
  templateLikeCount: number;
  templateForkCount: number;
  authorLineUserId: string;
  authorDisplayName: string | null;
  publishedAt: string;
}

interface SearchResponse {
  ideas: Idea[];
  hasMore: boolean;
  nextOffset: number;
}

interface PopularDestination {
  name: string;
  ideaCount: number;
}

interface DestinationsResponse {
  destinations: PopularDestination[];
}

const PAGE_SIZE = 24;

const ITEM_TYPE_OPTIONS: { value: ItemType; label: string; emoji: string }[] = [
  { value: "restaurant", label: "Eat", emoji: "🍜" },
  { value: "hotel", label: "Stay", emoji: "🏨" },
  { value: "activity", label: "Do", emoji: "🎒" },
  { value: "transport", label: "Move", emoji: "🚆" },
  { value: "flight", label: "Fly", emoji: "✈️" },
  { value: "other", label: "Other", emoji: "✨" },
];

const ITEM_TYPE_META: Record<ItemType, { label: string; emoji: string; tone: string }> = {
  restaurant: { label: "Eat", emoji: "🍜", tone: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200" },
  hotel: { label: "Stay", emoji: "🏨", tone: "bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-200" },
  activity: { label: "Do", emoji: "🎒", tone: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200" },
  transport: { label: "Move", emoji: "🚆", tone: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200" },
  flight: { label: "Fly", emoji: "✈️", tone: "bg-indigo-100 text-indigo-900 dark:bg-indigo-950 dark:text-indigo-200" },
  insurance: { label: "Cover", emoji: "🛡️", tone: "bg-slate-100 text-slate-900 dark:bg-slate-900 dark:text-slate-200" },
  other: { label: "Other", emoji: "✨", tone: "bg-pink-100 text-pink-900 dark:bg-pink-950 dark:text-pink-200" },
};

export function IdeasDiscoveryClient() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [q, setQ] = useState(searchParams.get("q") ?? "");
  const [destination, setDestination] = useState(searchParams.get("destination") ?? "");
  const [sort, setSort] = useState<SortOrder>(
    (searchParams.get("sort") as SortOrder | null) ?? "recent"
  );
  const [itemTypes, setItemTypes] = useState<ItemType[]>(() => {
    const raw = searchParams.get("itemTypes");
    if (!raw) return [];
    return raw.split(",").filter((t): t is ItemType =>
      ITEM_TYPE_OPTIONS.some((o) => o.value === t)
    );
  });

  const [items, setItems] = useState<Idea[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);

  const [popularDestinations, setPopularDestinations] = useState<PopularDestination[]>([]);

  // Debounce q + destination → URL sync
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      syncUrl({ q, destination, sort, itemTypes });
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, destination]);

  useEffect(() => {
    syncUrl({ q, destination, sort, itemTypes });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sort, itemTypes]);

  const currentParams = useMemo(
    () => ({
      q: searchParams.get("q") ?? "",
      destination: searchParams.get("destination") ?? "",
      sort: (searchParams.get("sort") as SortOrder | null) ?? "recent",
      itemTypes: (searchParams.get("itemTypes") ?? "")
        .split(",")
        .map((t) => t.trim())
        .filter((t): t is ItemType => ITEM_TYPE_OPTIONS.some((o) => o.value === t)),
    }),
    [searchParams]
  );

  const fetchPage = useCallback(
    async (newOffset: number, replace: boolean) => {
      if (replace) setLoading(true);
      else setLoadingMore(true);
      setError(null);

      const params = new URLSearchParams();
      if (currentParams.q) params.set("q", currentParams.q);
      if (currentParams.destination) params.set("destination", currentParams.destination);
      if (currentParams.sort !== "recent") params.set("sort", currentParams.sort);
      if (currentParams.itemTypes.length > 0) {
        params.set("itemTypes", currentParams.itemTypes.join(","));
      }
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String(newOffset));

      try {
        const res = await appFetchJson<SearchResponse>(
          `/api/app/ideas?${params.toString()}`
        );
        setItems((prev) => (replace ? res.ideas : [...prev, ...res.ideas]));
        setHasMore(res.hasMore);
        setOffset(res.nextOffset);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load ideas");
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [currentParams]
  );

  useEffect(() => {
    setOffset(0);
    void fetchPage(0, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    currentParams.q,
    currentParams.destination,
    currentParams.sort,
    currentParams.itemTypes.join(","),
  ]);

  // Popular destinations load once
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await appFetchJson<DestinationsResponse>(
          "/api/app/ideas/destinations"
        );
        if (!cancelled) setPopularDestinations(res.destinations);
      } catch {
        // Non-critical — chips just won't render
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function syncUrl(next: {
    q: string;
    destination: string;
    sort: SortOrder;
    itemTypes: ItemType[];
  }) {
    const params = new URLSearchParams();
    if (next.q.trim()) params.set("q", next.q.trim());
    if (next.destination.trim()) params.set("destination", next.destination.trim());
    if (next.sort !== "recent") params.set("sort", next.sort);
    if (next.itemTypes.length > 0) params.set("itemTypes", next.itemTypes.join(","));
    const qs = params.toString();
    router.replace(qs ? `/app/ideas?${qs}` : "/app/ideas", { scroll: false });
  }

  function toggleItemType(type: ItemType) {
    setItemTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );
  }

  function clearFilters() {
    setQ("");
    setDestination("");
    setSort("recent");
    setItemTypes([]);
  }

  const hasAnyFilter =
    currentParams.q !== "" ||
    currentParams.destination !== "" ||
    currentParams.sort !== "recent" ||
    currentParams.itemTypes.length > 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[var(--foreground)]">Ideas</h1>
        <p className="text-sm text-[var(--muted-foreground)]">
          Discover individual places, meals, and experiences shared by other travelers — bite-sized inspiration without forking a whole itinerary.
        </p>
      </div>

      {/* Filters */}
      <div className="space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--background)] p-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="ideas-search">Search</Label>
            <Input
              id="ideas-search"
              type="search"
              placeholder="Place, dish, attraction (e.g. ramen, shrine)"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Sort by</Label>
            <Select value={sort} onValueChange={(v) => setSort(v as SortOrder)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="recent">Newest</SelectItem>
                <SelectItem value="popular">Most loved</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ideas-destination">Destination</Label>
          <Input
            id="ideas-destination"
            type="search"
            placeholder="Filter by city or country (e.g. Tokyo)"
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
          />
          {popularDestinations.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {popularDestinations.map((d) => {
                const active = destination.toLowerCase() === d.name.toLowerCase();
                return (
                  <button
                    key={d.name}
                    type="button"
                    onClick={() => setDestination(active ? "" : d.name)}
                    className={`rounded-full border px-2.5 py-0.5 text-[11px] transition-colors ${
                      active
                        ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)]"
                        : "border-[var(--border)] text-[var(--muted-foreground)] hover:border-[var(--foreground)]/30 hover:text-[var(--foreground)]"
                    }`}
                  >
                    {d.name}
                    <span className="ml-1 opacity-70">{d.ideaCount}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="space-y-1.5">
          <Label>Type</Label>
          <div className="flex flex-wrap gap-1.5">
            {ITEM_TYPE_OPTIONS.map((opt) => {
              const active = itemTypes.includes(opt.value);
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => toggleItemType(opt.value)}
                  className={`flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                    active
                      ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)]"
                      : "border-[var(--border)] text-[var(--muted-foreground)] hover:border-[var(--foreground)]/30 hover:text-[var(--foreground)]"
                  }`}
                >
                  <span>{opt.emoji}</span>
                  <span>{opt.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {hasAnyFilter && (
          <div className="flex justify-end">
            <Button type="button" variant="outline" size="sm" onClick={clearFilters}>
              Clear filters
            </Button>
          </div>
        )}
      </div>

      {/* Results */}
      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {error}
        </div>
      )}

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-56 animate-pulse rounded-2xl bg-[var(--secondary)]"
            />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--background)] p-12 text-center">
          <p className="text-sm font-semibold">No ideas yet</p>
          <p className="mx-auto mt-1 max-w-md text-xs text-[var(--muted-foreground)]">
            {hasAnyFilter
              ? "Nothing matches these filters yet. Try loosening them or clearing the search."
              : "When travelers publish public templates, the individual places and activities inside them will show up here as ideas."}
          </p>
          {hasAnyFilter && (
            <div className="mt-4">
              <Button variant="outline" size="sm" onClick={clearFilters}>
                Clear filters
              </Button>
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((idea) => (
              <IdeaCard
                key={idea.id}
                idea={idea}
                onTypeClick={(type) => {
                  if (!itemTypes.includes(type)) {
                    setItemTypes((prev) => [...prev, type]);
                  }
                }}
                onDestinationClick={(d) => setDestination(d)}
              />
            ))}
          </div>

          {hasMore && (
            <div className="flex justify-center">
              <Button
                variant="outline"
                onClick={() => void fetchPage(offset, false)}
                disabled={loadingMore}
              >
                {loadingMore ? "Loading…" : "Load more"}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function IdeaCard({
  idea,
  onTypeClick,
  onDestinationClick,
}: {
  idea: Idea;
  onTypeClick: (type: ItemType) => void;
  onDestinationClick: (destination: string) => void;
}) {
  const meta = ITEM_TYPE_META[idea.itemType] ?? ITEM_TYPE_META.other;
  const headline = idea.placeName?.trim() || idea.title;

  return (
    <article className="group flex flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--background)] transition-colors hover:border-[var(--foreground)]/20">
      <Link href={`/app/templates/${idea.templateSlug}`} className="block">
        {idea.templateCoverImageUrl ? (
          <div className="aspect-[16/9] overflow-hidden bg-[var(--secondary)]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={idea.templateCoverImageUrl}
              alt={idea.templateTitle}
              className="h-full w-full object-cover transition-transform group-hover:scale-105"
            />
          </div>
        ) : (
          <div className="flex aspect-[16/9] items-center justify-center bg-gradient-to-br from-[var(--secondary)] to-[var(--secondary)]/50">
            <span className="text-3xl" aria-hidden>
              {meta.emoji}
            </span>
          </div>
        )}
      </Link>

      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="line-clamp-2 min-w-0 flex-1 text-sm font-semibold text-[var(--foreground)]">
            {headline}
          </h3>
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              onTypeClick(idea.itemType);
            }}
            className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${meta.tone}`}
            aria-label={`Filter by ${meta.label}`}
          >
            {meta.emoji} {meta.label}
          </button>
        </div>

        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            onDestinationClick(idea.destinationName);
          }}
          className="self-start text-[11px] text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
        >
          📍 {idea.destinationName}
        </button>

        {idea.address && (
          <p className="line-clamp-1 text-[11px] text-[var(--muted-foreground)]">
            {idea.address}
          </p>
        )}

        {idea.notes && (
          <p className="line-clamp-3 text-xs text-[var(--muted-foreground)]">
            {idea.notes}
          </p>
        )}

        <div className="mt-auto flex flex-col gap-2 border-t border-[var(--border)] pt-2">
          <div className="flex items-center gap-2 text-[11px] text-[var(--muted-foreground)]">
            <span className="truncate">
              From{" "}
              <Link
                href={`/app/templates/${idea.templateSlug}`}
                className="font-medium text-[var(--foreground)] hover:underline"
              >
                {idea.templateTitle}
              </Link>
            </span>
          </div>
          <div className="flex items-center justify-between text-[11px] text-[var(--muted-foreground)]">
            <span className="truncate">
              by {idea.authorDisplayName ?? "a traveler"}
            </span>
            <span className="flex items-center gap-2">
              <span>♡ {idea.templateLikeCount}</span>
              <span>↗ {idea.templateForkCount}</span>
            </span>
          </div>
          {idea.externalUrl && (
            <a
              href={idea.externalUrl}
              target="_blank"
              rel="noreferrer noopener"
              onClick={(e) => e.stopPropagation()}
              className="text-[11px] font-medium text-[var(--primary)] hover:underline"
            >
              Visit site ↗
            </a>
          )}
        </div>
      </div>
    </article>
  );
}

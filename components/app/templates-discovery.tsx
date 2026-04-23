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
import type { TemplateVisibility } from "@/lib/types";

type SortOrder = "recent" | "forks" | "likes";

interface SearchResultItem {
  slug: string;
  visibility: TemplateVisibility;
  fork_count: number;
  like_count: number;
  comment_count: number;
  author_line_user_id: string;
  title: string;
  destination_name: string;
  duration_days: number;
  summary: string | null;
  cover_image_url: string | null;
  tags: string[];
  published_at: string;
}

interface SearchResponse {
  templates: SearchResultItem[];
  hasMore: boolean;
  nextOffset: number;
}

const DURATION_OPTIONS = [
  { value: "any", label: "Any duration", min: null as number | null, max: null as number | null },
  { value: "short", label: "1–3 days", min: 1, max: 3 },
  { value: "medium", label: "4–7 days", min: 4, max: 7 },
  { value: "long", label: "8+ days", min: 8, max: null as number | null },
] as const;

const PAGE_SIZE = 20;

export function TemplatesDiscoveryClient() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Initialize from URL
  const [q, setQ] = useState(searchParams.get("q") ?? "");
  const [sort, setSort] = useState<SortOrder>(
    ((searchParams.get("sort") as SortOrder | null) ?? "recent")
  );
  const [durationKey, setDurationKey] = useState<string>(
    searchParams.get("duration") ?? "any"
  );
  const [tags, setTags] = useState<string[]>(
    (searchParams.get("tags") ?? "").split(",").map((t) => t.trim()).filter(Boolean)
  );
  const [tagInput, setTagInput] = useState("");
  const tagInputRef = useRef<HTMLInputElement>(null);

  const [items, setItems] = useState<SearchResultItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);

  // Debounce search input → URL + query
  const qDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (qDebounceRef.current) clearTimeout(qDebounceRef.current);
    qDebounceRef.current = setTimeout(() => {
      syncUrl({ q, sort, durationKey, tags });
    }, 300);
    return () => {
      if (qDebounceRef.current) clearTimeout(qDebounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  // Non-debounced filters
  useEffect(() => {
    syncUrl({ q, sort, durationKey, tags });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sort, durationKey, tags]);

  // Reactive fetch — whenever search params change, reset and refetch
  const currentParams = useMemo(
    () => ({
      q: searchParams.get("q") ?? "",
      sort: (searchParams.get("sort") as SortOrder | null) ?? "recent",
      durationKey: searchParams.get("duration") ?? "any",
      tags: (searchParams.get("tags") ?? "").split(",").map((t) => t.trim()).filter(Boolean),
    }),
    [searchParams]
  );

  useEffect(() => {
    setOffset(0);
    void fetchPage(0, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentParams.q, currentParams.sort, currentParams.durationKey, currentParams.tags.join(",")]);

  const fetchPage = useCallback(
    async (newOffset: number, replace: boolean) => {
      if (replace) setLoading(true);
      else setLoadingMore(true);
      setError(null);

      const duration = DURATION_OPTIONS.find((o) => o.value === currentParams.durationKey);
      const params = new URLSearchParams();
      if (currentParams.q) params.set("q", currentParams.q);
      if (currentParams.sort !== "recent") params.set("sort", currentParams.sort);
      if (duration?.min != null) params.set("durationMin", String(duration.min));
      if (duration?.max != null) params.set("durationMax", String(duration.max));
      if (currentParams.tags.length > 0) params.set("tags", currentParams.tags.join(","));
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String(newOffset));

      try {
        const res = await appFetchJson<SearchResponse>(`/api/app/templates?${params.toString()}`);
        setItems((prev) => (replace ? res.templates : [...prev, ...res.templates]));
        setHasMore(res.hasMore);
        setOffset(res.nextOffset);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load templates");
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [currentParams]
  );

  function syncUrl(next: {
    q: string;
    sort: SortOrder;
    durationKey: string;
    tags: string[];
  }) {
    const params = new URLSearchParams();
    if (next.q.trim()) params.set("q", next.q.trim());
    if (next.sort !== "recent") params.set("sort", next.sort);
    if (next.durationKey !== "any") params.set("duration", next.durationKey);
    if (next.tags.length > 0) params.set("tags", next.tags.join(","));
    const qs = params.toString();
    router.replace(qs ? `/app/templates?${qs}` : "/app/templates", { scroll: false });
  }

  function addTag(raw: string) {
    const tag = raw.trim().toLowerCase().replace(/,/g, "");
    if (!tag || tags.includes(tag)) return;
    setTags((prev) => [...prev, tag]);
    setTagInput("");
  }
  function removeTag(tag: string) {
    setTags((prev) => prev.filter((t) => t !== tag));
  }

  function handleTagKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag(tagInput);
    } else if (e.key === "Backspace" && tagInput === "" && tags.length > 0) {
      setTags((prev) => prev.slice(0, -1));
    }
  }

  function clearFilters() {
    setQ("");
    setSort("recent");
    setDurationKey("any");
    setTags([]);
  }

  const hasAnyFilter =
    currentParams.q !== "" ||
    currentParams.sort !== "recent" ||
    currentParams.durationKey !== "any" ||
    currentParams.tags.length > 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[var(--foreground)]">Templates</h1>
        <p className="text-sm text-[var(--muted-foreground)]">
          Browse trip itineraries shared by other travelers. Pick one and fork it into your group.
        </p>
      </div>

      {/* Search + filters */}
      <div className="space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--background)] p-4">
        <div className="space-y-1.5">
          <Label htmlFor="tmpl-search">Search</Label>
          <Input
            id="tmpl-search"
            type="search"
            placeholder="Destination or title (e.g. Tokyo, honeymoon)"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Duration</Label>
            <Select value={durationKey} onValueChange={setDurationKey}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {DURATION_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Sort by</Label>
            <Select value={sort} onValueChange={(v) => setSort(v as SortOrder)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="recent">Newest</SelectItem>
                <SelectItem value="forks">Most forked</SelectItem>
                <SelectItem value="likes">Most liked</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="tmpl-tags">Tags</Label>
          <div
            className="flex min-h-[2.5rem] flex-wrap items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm cursor-text focus-within:ring-1 focus-within:ring-[var(--ring)]"
            onClick={() => tagInputRef.current?.focus()}
          >
            {tags.map((tag) => (
              <span
                key={tag}
                className="flex items-center gap-1 rounded-full bg-[var(--secondary)] px-2 py-0.5 text-xs font-medium"
              >
                {tag}
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); removeTag(tag); }}
                  className="text-[var(--muted-foreground)] hover:text-[var(--foreground)] leading-none"
                  aria-label={`Remove tag ${tag}`}
                >
                  ×
                </button>
              </span>
            ))}
            <input
              ref={tagInputRef}
              id="tmpl-tags"
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={handleTagKeyDown}
              onBlur={() => addTag(tagInput)}
              placeholder={tags.length === 0 ? "Filter by tag… press Enter" : ""}
              className="min-w-[8rem] flex-1 bg-transparent outline-none placeholder:text-[var(--muted-foreground)] text-xs"
            />
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
            <div key={i} className="h-64 animate-pulse rounded-2xl bg-[var(--secondary)]" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--background)] p-12 text-center">
          <p className="text-sm text-[var(--muted-foreground)]">
            {hasAnyFilter
              ? "No templates match these filters. Try loosening them."
              : "No templates published yet. Be the first to share one!"}
          </p>
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item) => (
              <TemplateCard
                key={item.slug}
                item={item}
                onTagClick={(tag) => {
                  if (!tags.includes(tag)) setTags((prev) => [...prev, tag]);
                }}
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

function TemplateCard({
  item,
  onTagClick,
}: {
  item: SearchResultItem;
  onTagClick: (tag: string) => void;
}) {
  return (
    <article className="group flex flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--background)] transition-colors hover:border-[var(--foreground)]/20">
      <Link href={`/app/templates/${item.slug}`} className="block">
        {item.cover_image_url ? (
          <div className="aspect-[16/9] overflow-hidden bg-[var(--secondary)]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={item.cover_image_url}
              alt={item.title}
              className="h-full w-full object-cover transition-transform group-hover:scale-105"
            />
          </div>
        ) : (
          <div className="aspect-[16/9] bg-gradient-to-br from-[var(--secondary)] to-[var(--secondary)]/50 flex items-center justify-center">
            <span className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
              {item.destination_name}
            </span>
          </div>
        )}
      </Link>

      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <Link href={`/app/templates/${item.slug}`} className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-[var(--foreground)] line-clamp-2 group-hover:text-[var(--primary)]">
              {item.title}
            </h3>
          </Link>
          {item.visibility === "request_only" && (
            <span
              title="Request access to view details"
              className="shrink-0 rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-800 dark:bg-sky-950 dark:text-sky-200"
            >
              🔒 Request
            </span>
          )}
        </div>

        <div className="flex flex-wrap gap-1.5 text-[11px] text-[var(--muted-foreground)]">
          <span>{item.destination_name}</span>
          <span>·</span>
          <span>{item.duration_days} {item.duration_days === 1 ? "day" : "days"}</span>
        </div>

        {item.summary && (
          <p className="text-xs text-[var(--muted-foreground)] line-clamp-2">{item.summary}</p>
        )}

        {item.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {item.tags.slice(0, 4).map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); onTagClick(tag); }}
                className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[10px] text-[var(--muted-foreground)] hover:border-[var(--foreground)]/30 hover:text-[var(--foreground)]"
              >
                {tag}
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center gap-3 pt-2 text-[11px] text-[var(--muted-foreground)] border-t border-[var(--border)] mt-auto">
          <span>↗ {item.fork_count}</span>
          <span>♡ {item.like_count}</span>
          <span>💬 {item.comment_count}</span>
        </div>
      </div>
    </article>
  );
}

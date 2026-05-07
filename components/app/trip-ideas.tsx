"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  IDEA_CATEGORIES,
  type IdeaCategory,
  type TripIdea,
  type TripIdeasResponse,
} from "@/lib/app-ideas";

const CATEGORY_LABEL: Record<IdeaCategory, string> = {
  destination: "Destination",
  hotel: "Hotel",
  activity: "Activity",
  restaurant: "Restaurant",
  general: "General",
};

const CATEGORY_BADGE: Record<IdeaCategory, string> = {
  destination: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
  hotel: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
  activity: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  restaurant: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  general: "bg-[var(--secondary)] text-[var(--muted-foreground)]",
};

type Filter = IdeaCategory | "all";

const MAX_LENGTH = 500;

export function TripIdeasClient({ tripId }: { tripId: string }) {
  const [ideas, setIdeas] = useState<TripIdea[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");

  const [text, setText] = useState("");
  const [category, setCategory] = useState<IdeaCategory>("general");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await appFetchJson<TripIdeasResponse>(
        `/api/app/trips/${tripId}/ideas`
      );
      setIdeas(res.ideas);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load ideas");
    }
  }, [tripId]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    if (!ideas) return [];
    if (filter === "all") return ideas;
    return ideas.filter((i) => i.category === filter);
  }, [ideas, filter]);

  const counts = useMemo(() => {
    const map: Record<Filter, number> = {
      all: 0,
      destination: 0,
      hotel: 0,
      activity: 0,
      restaurant: 0,
      general: 0,
    };
    for (const i of ideas ?? []) {
      map.all += 1;
      map[i.category] += 1;
    }
    return map;
  }, [ideas]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) {
      setSubmitError("Add a few words for your idea.");
      return;
    }
    if (trimmed.length > MAX_LENGTH) {
      setSubmitError(`Keep it under ${MAX_LENGTH} characters.`);
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await appFetchJson<{ idea: TripIdea }>(
        `/api/app/trips/${tripId}/ideas`,
        {
          method: "POST",
          body: JSON.stringify({ text: trimmed, category }),
        }
      );
      setIdeas((prev) => (prev ? [res.idea, ...prev] : [res.idea]));
      setText("");
      setCategory("general");
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to share idea");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      await appFetchJson(
        `/api/app/trips/${tripId}/ideas?id=${encodeURIComponent(id)}`,
        { method: "DELETE" }
      );
      setIdeas((prev) => (prev ? prev.filter((i) => i.id !== id) : prev));
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to delete idea");
    } finally {
      setDeletingId(null);
    }
  }

  if (loadError && !ideas) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
        {loadError}{" "}
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

  if (!ideas) {
    return <div className="h-64 animate-pulse rounded-2xl bg-[var(--secondary)]" />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Ideas</h2>
        <p className="text-xs text-[var(--muted-foreground)]">
          Brainstorm with your group. Anyone in the trip can drop a suggestion;
          the organizer can later promote one to a vote.
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--background)] p-4"
      >
        <div className="space-y-1.5">
          <Label htmlFor="idea-text">Share an idea</Label>
          <Textarea
            id="idea-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="e.g. Let's check out Arashiyama bamboo grove"
            rows={3}
            maxLength={MAX_LENGTH}
            disabled={submitting}
          />
          <div className="flex items-center justify-between text-[11px] text-[var(--muted-foreground)]">
            <span>Visible to everyone in this trip&apos;s group.</span>
            <span>
              {text.trim().length}/{MAX_LENGTH}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="idea-category">Category</Label>
            <Select
              value={category}
              onValueChange={(v) => setCategory(v as IdeaCategory)}
            >
              <SelectTrigger id="idea-category" className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {IDEA_CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {CATEGORY_LABEL[c]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button type="submit" disabled={submitting || text.trim().length === 0}>
            {submitting ? "Sharing…" : "Share idea"}
          </Button>
        </div>

        {submitError && (
          <p className="text-xs text-destructive">{submitError}</p>
        )}
      </form>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <FilterChip
          label={`All · ${counts.all}`}
          active={filter === "all"}
          onClick={() => setFilter("all")}
        />
        {IDEA_CATEGORIES.map((c) => (
          <FilterChip
            key={c}
            label={`${CATEGORY_LABEL[c]} · ${counts[c]}`}
            active={filter === c}
            onClick={() => setFilter(c)}
          />
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--background)] px-6 py-10 text-center text-sm text-[var(--muted-foreground)]">
          {ideas.length === 0
            ? "No ideas yet. Share the first one above."
            : "No ideas in this category yet."}
        </div>
      ) : (
        <ul className="space-y-3">
          {filtered.map((idea) => (
            <IdeaCard
              key={idea.id}
              idea={idea}
              onDelete={() => void handleDelete(idea.id)}
              deleting={deletingId === idea.id}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1 font-medium transition-colors",
        active
          ? "border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--primary)]"
          : "border-[var(--border)] text-[var(--muted-foreground)] hover:bg-[var(--secondary)]"
      )}
    >
      {label}
    </button>
  );
}

function IdeaCard({
  idea,
  onDelete,
  deleting,
}: {
  idea: TripIdea;
  onDelete: () => void;
  deleting: boolean;
}) {
  const author = idea.displayName ?? idea.submittedBy.slice(0, 6);
  const when = formatRelative(idea.createdAt);
  const canDelete = idea.isMine && !idea.promoted;
  return (
    <li className="rounded-2xl border border-[var(--border)] bg-[var(--background)] p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge
          variant="secondary"
          className={cn(
            "border-0 text-[10px] uppercase",
            CATEGORY_BADGE[idea.category]
          )}
        >
          {CATEGORY_LABEL[idea.category]}
        </Badge>
        {idea.promoted && (
          <Badge className="border-0 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
            Promoted
          </Badge>
        )}
        {idea.isMine && (
          <span className="rounded-full bg-[var(--primary)]/10 px-2 py-0.5 text-[10px] font-semibold text-[var(--primary)]">
            You
          </span>
        )}
      </div>
      <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-[var(--foreground)]">
        {idea.text}
      </p>
      <div className="mt-3 flex items-center justify-between text-[11px] text-[var(--muted-foreground)]">
        <span>
          {author} · {when}
        </span>
        {canDelete && (
          <button
            type="button"
            onClick={onDelete}
            disabled={deleting}
            className="text-[11px] font-medium text-[var(--muted-foreground)] hover:text-destructive disabled:opacity-60"
          >
            {deleting ? "Removing…" : "Remove"}
          </button>
        )}
      </div>
    </li>
  );
}

function formatRelative(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const diffMs = Date.now() - t;
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

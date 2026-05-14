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
  TabPageHeader,
  TabError,
  TabSkeleton,
  TabEmptyState,
} from "@/components/app/tab-shell";
import {
  IDEA_CATEGORIES,
  type IdeaCategory,
  type TripIdea,
  type TripIdeasResponse,
} from "@/lib/app-ideas";

const CATEGORY_LABEL: Record<IdeaCategory, string> = {
  destination: "目的地",
  hotel: "住宿",
  activity: "活動",
  restaurant: "餐廳",
  general: "一般",
};

const CATEGORY_BADGE: Record<IdeaCategory, string> = {
  destination: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
  hotel: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
  activity: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  restaurant: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  general: "bg-[var(--surface-sunken)] text-[var(--text-muted)]",
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
      setLoadError(err instanceof Error ? err.message : "靈感載入失敗");
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
      setSubmitError("請輸入一點靈感內容。");
      return;
    }
    if (trimmed.length > MAX_LENGTH) {
      setSubmitError(`請控制在 ${MAX_LENGTH} 字以內。`);
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
      setSubmitError(err instanceof Error ? err.message : "分享靈感失敗");
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
      setSubmitError(err instanceof Error ? err.message : "刪除靈感失敗");
    } finally {
      setDeletingId(null);
    }
  }

  if (loadError && !ideas) {
    return <TabError message={loadError} onRetry={() => void load()} />;
  }

  if (!ideas) {
    return <TabSkeleton />;
  }

  return (
    <div className="space-y-6">
      <TabPageHeader
        id="ideas-page-header"
        title="靈感"
        subtitle="和旅伴一起發想。任何成員都能留下建議，主揪之後可以把靈感轉成投票。"
      />

      <form
        onSubmit={handleSubmit}
        className="surface-tile space-y-3 p-5"
      >
        <div className="space-y-1.5">
          <Label htmlFor="idea-text">分享靈感</Label>
          <Textarea
            id="idea-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="例如：想去嵐山竹林走走"
            rows={3}
            maxLength={MAX_LENGTH}
            disabled={submitting}
          />
          <div className="flex items-center justify-between text-[11px] text-[var(--text-muted)]">
            <span>旅程群組中的所有人都看得到。</span>
            <span className="text-mono">
              {text.trim().length}/{MAX_LENGTH}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="idea-category">分類</Label>
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
            {submitting ? "分享中..." : "分享靈感"}
          </Button>
        </div>

        {submitError && (
          <p className="text-xs text-destructive">{submitError}</p>
        )}
      </form>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <FilterChip
          label={`全部 · ${counts.all}`}
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
        <TabEmptyState
          message={
            ideas.length === 0
              ? "還沒有靈感。先在上方分享第一個吧。"
              : "這個分類還沒有靈感。"
          }
        />
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
          ? "border-[var(--accent-line)] bg-[var(--accent-line-soft)] text-[var(--accent-line)]"
          : "border-[var(--border-hairline)] text-[var(--text-muted)] hover:bg-[var(--surface-sunken)]"
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
    <li className="surface-tile tile-interactive p-4">
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
          <Badge className="border-0 bg-[var(--status-settled-soft)] text-[var(--status-settled)]">
            已轉成投票
          </Badge>
        )}
        {idea.isMine && (
          <span className="rounded-full bg-[var(--accent-line-soft)] px-2 py-0.5 text-[10px] font-semibold text-[var(--accent-line)]">
            你
          </span>
        )}
      </div>
      <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-[var(--text-primary)]">
        {idea.text}
      </p>
      <div className="mt-3 flex items-center justify-between text-[11px] text-[var(--text-muted)]">
        <span>
          {author} · {when}
        </span>
        {canDelete && (
          <button
            type="button"
            onClick={onDelete}
            disabled={deleting}
            className="text-[11px] font-medium text-[var(--text-muted)] hover:text-[var(--status-blocked)] disabled:opacity-60"
          >
            {deleting ? "移除中..." : "移除"}
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
  if (minutes < 1) return "剛剛";
  if (minutes < 60) return `${minutes} 分鐘前`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} 小時前`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} 天前`;
  return new Date(iso).toLocaleDateString("zh-TW");
}

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
import { TemplateCommentsSection } from "@/components/app/template-comments";
import type {
  TripTemplate,
  TripTemplateVersion,
  TripTemplateItem,
  TemplateVisibility,
} from "@/lib/types";

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
  access: "full" | "preview";
  isAuthor: boolean;
  hasLiked: boolean;
}

interface Grant {
  line_user_id: string;
  display_name: string | null;
  granted_at: string;
  source: "invite" | "request";
}

const VISIBILITY_LABELS: Record<TemplateVisibility, string> = {
  public: "Public",
  private: "Private",
  request_only: "Request only",
};

export function TemplateDetailClient({
  slug,
  viewerLineUserId,
}: {
  slug: string;
  viewerLineUserId: string;
}) {
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

  const { template, version, items, access, isAuthor } = data;
  const byDay = groupByDay(items);
  const days = [...byDay.keys()].sort((a, b) => a - b);
  const canFork = access === "full";

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
              <VisibilityBadge visibility={template.visibility} />
              {isAuthor && (
                <span className="rounded-full bg-[var(--primary)]/10 text-[var(--primary)] px-2 py-0.5 font-semibold uppercase tracking-wide">
                  You own this
                </span>
              )}
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
          <div className="shrink-0">
            {canFork ? (
              <Button onClick={() => setForkOpen(true)}>Use this template</Button>
            ) : (
              <Button variant="outline" disabled title="Request access stub — coming in step 7">
                Request access
              </Button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4 text-xs text-[var(--muted-foreground)] border-t border-[var(--border)] pt-3">
          <span>{template.fork_count} {template.fork_count === 1 ? "fork" : "forks"}</span>
          <LikeButton
            slug={slug}
            initialHasLiked={data.hasLiked}
            initialLikeCount={template.like_count}
          />
          <span>v{version.version_number}</span>
          <span>Published {formatDate(version.published_at)}</span>
        </div>
      </header>

      {isAuthor && (
        <AuthorControls
          slug={slug}
          currentVisibility={template.visibility}
          onVisibilityChanged={(v) =>
            setData((prev) => (prev ? { ...prev, template: { ...prev.template, visibility: v } } : prev))
          }
        />
      )}

      {access === "preview" ? (
        <PreviewNotice />
      ) : (
        <section className="space-y-4">
          <h2 className="text-base font-semibold">Itinerary</h2>
          {days.length === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)]">
              No items in this template yet.
            </p>
          ) : (
            days.map((day) => (
              <DaySection key={day} day={day} items={byDay.get(day) ?? []} />
            ))
          )}
        </section>
      )}

      <TemplateCommentsSection
        slug={slug}
        viewerLineUserId={viewerLineUserId}
        isTemplateAuthor={isAuthor}
      />

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

function LikeButton({
  slug,
  initialHasLiked,
  initialLikeCount,
}: {
  slug: string;
  initialHasLiked: boolean;
  initialLikeCount: number;
}) {
  const [hasLiked, setHasLiked] = useState(initialHasLiked);
  const [count, setCount] = useState(initialLikeCount);
  const [pending, setPending] = useState(false);

  async function toggle() {
    if (pending) return;
    const wasLiked = hasLiked;

    // Optimistic update
    setHasLiked(!wasLiked);
    setCount((c) => c + (wasLiked ? -1 : 1));
    setPending(true);

    try {
      const res = await appFetchJson<{ liked: boolean; likeCount: number }>(
        `/api/app/templates/${slug}/like`,
        { method: wasLiked ? "DELETE" : "POST" }
      );
      // Reconcile with server truth
      setHasLiked(res.liked);
      setCount(res.likeCount);
    } catch {
      // Revert on failure
      setHasLiked(wasLiked);
      setCount((c) => c + (wasLiked ? 1 : -1));
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void toggle()}
      disabled={pending}
      aria-pressed={hasLiked}
      aria-label={hasLiked ? "Unlike this template" : "Like this template"}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 transition-colors ${
        hasLiked
          ? "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-200"
          : "text-[var(--muted-foreground)] hover:bg-[var(--secondary)]"
      } disabled:opacity-60`}
    >
      <span aria-hidden>{hasLiked ? "♥" : "♡"}</span>
      <span>{count} {count === 1 ? "like" : "likes"}</span>
    </button>
  );
}

function VisibilityBadge({ visibility }: { visibility: TemplateVisibility }) {
  const color =
    visibility === "public"
      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
      : visibility === "private"
      ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200"
      : "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200";
  return (
    <span className={`rounded-full px-2 py-0.5 font-semibold uppercase tracking-wide ${color}`}>
      {VISIBILITY_LABELS[visibility]}
    </span>
  );
}

function PreviewNotice() {
  return (
    <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--secondary)]/40 p-6 text-center space-y-2">
      <h3 className="text-base font-semibold">Itinerary hidden</h3>
      <p className="text-sm text-[var(--muted-foreground)]">
        This template is request-only. The day-by-day itinerary will unlock once the
        author approves your access request.
      </p>
    </div>
  );
}

function AuthorControls({
  slug,
  currentVisibility,
  onVisibilityChanged,
}: {
  slug: string;
  currentVisibility: TemplateVisibility;
  onVisibilityChanged: (v: TemplateVisibility) => void;
}) {
  const [visibility, setVisibility] = useState<TemplateVisibility>(currentVisibility);
  const [savingVis, setSavingVis] = useState(false);
  const [visError, setVisError] = useState<string | null>(null);

  async function handleVisibilityChange(next: TemplateVisibility) {
    const prev = visibility;
    setVisibility(next);
    setSavingVis(true);
    setVisError(null);
    try {
      await appFetchJson(`/api/app/templates/${slug}`, {
        method: "PATCH",
        body: JSON.stringify({ visibility: next }),
      });
      onVisibilityChanged(next);
    } catch (err) {
      setVisibility(prev);
      setVisError(err instanceof Error ? err.message : "Failed to update visibility");
    } finally {
      setSavingVis(false);
    }
  }

  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--background)] p-5 space-y-5">
      <div>
        <h2 className="text-base font-semibold">Author controls</h2>
        <p className="text-xs text-[var(--muted-foreground)]">
          Only you see this section.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label>Visibility</Label>
        <Select
          value={visibility}
          onValueChange={(v) => void handleVisibilityChange(v as TemplateVisibility)}
          disabled={savingVis}
        >
          <SelectTrigger className="w-full sm:w-[260px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="public">Public</SelectItem>
            <SelectItem value="request_only">Request only</SelectItem>
            <SelectItem value="private">Private</SelectItem>
          </SelectContent>
        </Select>
        {visError && <p className="text-xs text-destructive">{visError}</p>}
      </div>

      {visibility !== "public" && <GrantsManager slug={slug} />}
    </section>
  );
}

function GrantsManager({ slug }: { slug: string }) {
  const [grants, setGrants] = useState<Grant[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [newUserId, setNewUserId] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await appFetchJson<{ grants: Grant[] }>(
        `/api/app/templates/${slug}/grants`
      );
      setGrants(res.grants);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load invites");
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleAdd() {
    const trimmed = newUserId.trim();
    if (!trimmed) return;
    setAdding(true);
    setAddError(null);
    try {
      const res = await appFetchJson<{ grant: Grant }>(
        `/api/app/templates/${slug}/grants`,
        {
          method: "POST",
          body: JSON.stringify({ lineUserId: trimmed }),
        }
      );
      setGrants((prev) => {
        const others = (prev ?? []).filter((g) => g.line_user_id !== res.grant.line_user_id);
        return [res.grant, ...others];
      });
      setNewUserId("");
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Failed to add invite");
    } finally {
      setAdding(false);
    }
  }

  async function handleRemove(lineUserId: string) {
    const prev = grants;
    setGrants((curr) => (curr ?? []).filter((g) => g.line_user_id !== lineUserId));
    try {
      await appFetchJson(`/api/app/templates/${slug}/grants/${encodeURIComponent(lineUserId)}`, {
        method: "DELETE",
      });
    } catch {
      setGrants(prev);
    }
  }

  return (
    <div className="space-y-3 border-t border-[var(--border)] pt-5">
      <div>
        <h3 className="text-sm font-semibold">Invites</h3>
        <p className="text-xs text-[var(--muted-foreground)]">
          Invited users can access this template regardless of visibility.
        </p>
      </div>

      {loadError && <p className="text-xs text-destructive">{loadError}</p>}

      {grants && grants.length > 0 && (
        <ul className="divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]">
          {grants.map((g) => (
            <li key={g.line_user_id} className="flex items-center justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">
                  {g.display_name ?? "Unknown"}
                </div>
                <div className="text-[11px] text-[var(--muted-foreground)] font-mono truncate">
                  {g.line_user_id}
                </div>
                <div className="text-[11px] text-[var(--muted-foreground)]">
                  {g.source === "invite" ? "Invited" : "Approved from request"} · {formatDate(g.granted_at)}
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void handleRemove(g.line_user_id)}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}

      {grants && grants.length === 0 && (
        <p className="text-xs text-[var(--muted-foreground)]">No invites yet.</p>
      )}

      <div className="flex items-end gap-2">
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="grant-user-id">Invite by LINE user ID</Label>
          <Input
            id="grant-user-id"
            placeholder="U1234abcd..."
            value={newUserId}
            onChange={(e) => setNewUserId(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void handleAdd();
              }
            }}
          />
        </div>
        <Button type="button" onClick={() => void handleAdd()} disabled={adding || !newUserId.trim()}>
          {adding ? "Adding…" : "Invite"}
        </Button>
      </div>
      {addError && <p className="text-xs text-destructive">{addError}</p>}
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

  const endDate = startDate ? computeEndDate(startDate, durationDays) : null;

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

"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { appFetchJson } from "@/lib/app-client";
import type { Notification, NotificationKind } from "@/lib/types";

const PAGE_SIZE = 20;

export function InboxClient() {
  const [items, setItems] = useState<Notification[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);

  const load = useCallback(
    async (start: number, append: boolean) => {
      if (append) setLoadingMore(true);
      setLoadError(null);
      try {
        const res = await appFetchJson<{
          notifications: Notification[];
          hasMore: boolean;
          nextOffset: number;
        }>(`/api/app/notifications?limit=${PAGE_SIZE}&offset=${start}`);
        setItems((prev) =>
          append ? [...(prev ?? []), ...res.notifications] : res.notifications
        );
        setHasMore(res.hasMore);
        setOffset(res.nextOffset);
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : "Failed to load inbox");
      } finally {
        setLoadingMore(false);
      }
    },
    []
  );

  useEffect(() => {
    void load(0, false);
  }, [load]);

  async function handleMarkAll() {
    setMarkingAll(true);
    try {
      await appFetchJson<{ updated: number }>("/api/app/notifications/read", {
        method: "POST",
        body: JSON.stringify({ all: true }),
      });
      const now = new Date().toISOString();
      setItems((prev) =>
        (prev ?? []).map((n) => ({ ...n, read_at: n.read_at ?? now }))
      );
    } catch {
      // Best-effort — user can retry
    } finally {
      setMarkingAll(false);
    }
  }

  async function handleMarkOne(id: string) {
    // Optimistic mark
    const now = new Date().toISOString();
    setItems((prev) =>
      (prev ?? []).map((n) => (n.id === id && !n.read_at ? { ...n, read_at: now } : n))
    );
    try {
      await appFetchJson("/api/app/notifications/read", {
        method: "POST",
        body: JSON.stringify({ ids: [id] }),
      });
    } catch {
      // revert on failure
      setItems((prev) =>
        (prev ?? []).map((n) => (n.id === id ? { ...n, read_at: null } : n))
      );
    }
  }

  const unreadCount = (items ?? []).filter((n) => !n.read_at).length;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--foreground)]">Inbox</h1>
          <p className="text-sm text-[var(--muted-foreground)]">
            Notifications about your templates and access requests.
          </p>
        </div>
        {unreadCount > 0 && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void handleMarkAll()}
            disabled={markingAll}
          >
            {markingAll ? "Marking…" : "Mark all as read"}
          </Button>
        )}
      </div>

      {loadError && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {loadError}
        </div>
      )}

      {items === null ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-2xl bg-[var(--secondary)]" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--background)] p-12 text-center">
          <p className="text-sm text-[var(--muted-foreground)]">
            You&apos;re all caught up.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((n) => (
            <li key={n.id}>
              <NotificationRow notification={n} onMarkRead={() => void handleMarkOne(n.id)} />
            </li>
          ))}
        </ul>
      )}

      {hasMore && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load(offset, true)}
            disabled={loadingMore}
          >
            {loadingMore ? "Loading…" : "Load more"}
          </Button>
        </div>
      )}
    </div>
  );
}

function NotificationRow({
  notification,
  onMarkRead,
}: {
  notification: Notification;
  onMarkRead: () => void;
}) {
  const { message, href } = renderNotification(notification);
  const unread = !notification.read_at;

  return (
    <Link
      href={href}
      onClick={unread ? onMarkRead : undefined}
      className={`block rounded-2xl border p-4 transition-colors ${
        unread
          ? "border-[var(--primary)]/30 bg-[var(--primary)]/5 hover:bg-[var(--primary)]/10"
          : "border-[var(--border)] bg-[var(--background)] hover:border-[var(--foreground)]/20"
      }`}
    >
      <div className="flex items-start gap-3">
        {unread && (
          <span
            aria-hidden
            className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[var(--primary)]"
          />
        )}
        <div className="min-w-0 flex-1">
          <p className={`text-sm ${unread ? "font-medium text-[var(--foreground)]" : "text-[var(--foreground)]"}`}>
            {message}
          </p>
          <p className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">
            {formatRelative(notification.created_at)}
          </p>
        </div>
      </div>
    </Link>
  );
}

function renderNotification(n: Notification): { message: string; href: string } {
  const p = n.payload as {
    slug?: string;
    templateTitle?: string;
    requesterDisplayName?: string | null;
    commenterDisplayName?: string | null;
    forkerDisplayName?: string | null;
    authorDisplayName?: string | null;
    bodyExcerpt?: string;
    decision?: string;
  };
  const title = p.templateTitle ?? "your template";
  const href = p.slug ? `/app/templates/${p.slug}` : "/app/templates";
  const kind = n.kind as NotificationKind;

  switch (kind) {
    case "template.access_requested": {
      const who = p.requesterDisplayName ?? "Someone";
      return { message: `${who} requested access to your template “${title}”.`, href };
    }
    case "template.access_approved":
      return { message: `Your request to access “${title}” was approved.`, href };
    case "template.access_denied":
      return { message: `Your request to access “${title}” was denied.`, href };
    case "template.invited": {
      const who = p.authorDisplayName ?? "Someone";
      return { message: `${who} invited you to view “${title}”.`, href };
    }
    case "template.new_comment": {
      const who = p.commenterDisplayName ?? "Someone";
      const excerpt = p.bodyExcerpt ? `: “${p.bodyExcerpt}”` : "";
      return { message: `${who} commented on “${title}”${excerpt}`, href };
    }
    case "template.forked": {
      const who = p.forkerDisplayName ?? "Someone";
      return { message: `${who} forked your template “${title}”.`, href };
    }
    default:
      return { message: "You have a new notification.", href };
  }
}

function formatRelative(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffSec = Math.round((now.getTime() - date.getTime()) / 1000);
  if (diffSec < 60) return "just now";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  if (diffSec < 7 * 86400) return `${Math.floor(diffSec / 86400)}d ago`;
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { appFetchJson } from "@/lib/app-client";
import { GridTileError, GridTileSkeleton } from "@/components/app/grids/grid-tile";
import { ShareLinkDialog } from "@/components/app/grids/share-link-dialog";
import { SocialEmbed } from "@/components/app/social-embed";
import { detectSocial } from "@/lib/social/detect";
import type { ItemType } from "@/lib/types";
import type { SharedItem } from "@/app/api/app/trips/[tripId]/shared/route";

const TYPE_EMOJI: Record<ItemType, string> = {
  hotel: "🏨",
  restaurant: "🍽️",
  activity: "🎯",
  transport: "🚌",
  flight: "✈️",
  insurance: "🛡️",
  other: "📌",
};

/**
 * Bento tile listing every URL shared into this trip — newest first.
 * The same `trip_memories` rows surfaced here are also populated by the
 * LINE `/share` command, so links shared from chat appear automatically.
 */
export function SharedGrid({ tripId }: { tripId: string }) {
  const [items, setItems] = useState<SharedItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await appFetchJson<{ items: SharedItem[] }>(
        `/api/app/trips/${tripId}/shared`,
      );
      setItems(res.items);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    }
  }, [tripId]);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  const handleAdded = useCallback((item: SharedItem) => {
    setItems((prev) => {
      if (!prev) return [item];
      const without = prev.filter((p) => p.id !== item.id);
      return [item, ...without];
    });
  }, []);

  return (
    <>
      <ShareLinkDialog
        tripId={tripId}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onAdded={handleAdded}
      />

      <div className="flex h-full min-h-0 flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] uppercase tracking-wide text-[var(--text-faint)]">
            {items == null
              ? "Loading…"
              : items.length === 0
                ? "Nothing shared yet"
                : `${items.length} link${items.length === 1 ? "" : "s"}`}
          </p>
          <button
            type="button"
            onClick={() => setDialogOpen(true)}
            className="rounded-full border border-[var(--border-hairline)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)] hover:border-[var(--accent-line)] hover:text-[var(--text-primary)]"
            title="Share a new link"
          >
            + Share link
          </button>
        </div>

        {error && <GridTileError message={error} onRetry={() => void load()} />}

        {!error && items == null && <GridTileSkeleton />}

        {!error && items && items.length === 0 && (
          <EmptyState onAdd={() => setDialogOpen(true)} />
        )}

        {!error && items && items.length > 0 && (
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {items.map((item) => {
              const isSocial =
                item.bookingUrl != null && detectSocial(item.bookingUrl) != null;
              return (
                <li key={item.id} className={isSocial ? "sm:col-span-2" : undefined}>
                  <SharedCard item={item} />
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}

function SharedCard({ item }: { item: SharedItem }) {
  const social = item.bookingUrl ? detectSocial(item.bookingUrl) : null;
  if (social) return <SocialCard item={item} url={item.bookingUrl!} />;

  const meta: string[] = [];
  if (typeof item.rating === "number") meta.push(`⭐ ${item.rating.toFixed(1)}`);
  if (item.priceLevel) meta.push(item.priceLevel);
  if (item.mentionCount > 1) meta.push(`×${item.mentionCount}`);

  const inner = (
    <div className="flex h-full gap-3 rounded-[var(--radius-md)] border border-[var(--border-hairline)] bg-[var(--surface-base)] p-2.5 transition-[border-color,box-shadow] hover:border-[var(--accent-line)] hover:shadow-[var(--shadow-flat)]">
      {item.imageUrl ? (
        // Using <img> rather than next/image because shared URLs come from
        // arbitrary hosts and adding each one to next.config remotePatterns
        // would be impractical.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.imageUrl}
          alt=""
          loading="lazy"
          className="h-16 w-16 shrink-0 rounded-[var(--radius-sm)] object-cover"
        />
      ) : (
        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--surface-sunken)] text-2xl">
          {TYPE_EMOJI[item.itemType] ?? "📌"}
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-1.5">
          <span aria-hidden className="text-xs">
            {TYPE_EMOJI[item.itemType] ?? "📌"}
          </span>
          <p className="truncate text-sm font-semibold text-[var(--text-primary)]">
            {item.title}
          </p>
        </div>
        {item.summary && (
          <p className="line-clamp-2 text-xs text-[var(--text-muted)]">
            {item.summary}
          </p>
        )}
        {meta.length > 0 && (
          <p className="text-[10px] uppercase tracking-wide text-[var(--text-faint)]">
            {meta.join("  ·  ")}
          </p>
        )}
        {item.address && (
          <p className="truncate text-[10px] text-[var(--text-faint)]">
            📍 {item.address}
          </p>
        )}
      </div>
    </div>
  );

  if (item.bookingUrl) {
    return (
      <a
        href={item.bookingUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="block h-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-line)] focus-visible:ring-offset-2"
      >
        {inner}
      </a>
    );
  }
  return inner;
}

function SocialCard({ item, url }: { item: SharedItem; url: string }) {
  return (
    <div className="flex h-full flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--border-hairline)] bg-[var(--surface-base)] p-2.5">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 truncate text-sm font-semibold text-[var(--text-primary)]">
          {item.title}
        </p>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 text-[10px] uppercase tracking-wide text-[var(--text-faint)] hover:text-[var(--text-primary)]"
        >
          Open ↗
        </a>
      </div>
      <SocialEmbed url={url} />
    </div>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-[var(--radius-md)] border border-dashed border-[var(--border-hairline)] px-4 py-6 text-center">
      <p className="text-sm text-[var(--text-secondary)]">
        Share links to hotels, restaurants, flights, and activities here.
      </p>
      <p className="text-xs text-[var(--text-faint)]">
        Tip: type{" "}
        <code className="rounded bg-[var(--surface-sunken)] px-1 py-0.5 text-[10px]">
          /share &lt;url&gt;
        </code>{" "}
        in your LINE group, or paste one below.
      </p>
      <button
        type="button"
        onClick={onAdd}
        className="mt-1 rounded-full bg-[var(--accent-line)] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
      >
        + Share a link
      </button>
    </div>
  );
}

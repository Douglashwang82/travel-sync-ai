"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { appFetchJson, AppApiFetchError } from "@/lib/app-client";
import { readAppBrowserCache, writeAppBrowserCache } from "@/lib/app-browser-cache";
import { useAppLocale } from "@/components/app/app-locale-provider";
import { ItemDetailDialog } from "@/components/app/item-detail-dialog";
import { AddItemDialog } from "@/components/app/add-item-dialog";
import { TripHeroTile, type HeroVariant, HERO_VARIANTS } from "@/components/app/trip-hero-tile";
import { DecisionCenterTile } from "@/components/app/trip-decision-center";
import { FinanceTile } from "@/components/app/trip-finance-panel";
import { ActionQueueTile } from "@/components/app/trip-action-queue";
import { AIUpdatesTile } from "@/components/app/trip-ai-updates";
import { NextUpTile } from "@/components/app/trip-next-up-tile";
import { CommandPalette, useCommandPalette } from "@/components/app/command-palette";
import { cn } from "@/lib/utils";
import type { BoardData, Trip, TripItem } from "@/lib/types";
import type { AppMember } from "@/app/api/app/trips/[tripId]/members/route";
import type { AppExpensesResponse } from "@/lib/app-trip-expenses";
import type { WebVotesResponse } from "@/app/api/app/trips/[tripId]/votes/route";
import type { AppSessionResponse } from "@/app/api/app/session/route";

interface OverviewData {
  board: BoardData;
  members: AppMember[];
  expenses: AppExpensesResponse;
  trip: Trip;
  role: "organizer" | "member";
  votes: WebVotesResponse;
  meLineUserId: string;
}

const OVERVIEW_CACHE_BUCKET = "trip-overview-bento";
const OVERVIEW_CACHE_MAX_AGE_MS = 60 * 1000;

const COPY = {
  en: {
    skeletonHero: "Loading workspace…",
    retry: "Retry",
    failed: "Failed to load trip overview",
  },
  "zh-TW": {
    skeletonHero: "載入工作區中…",
    retry: "重試",
    failed: "無法載入旅程資料",
  },
} as const;

export function TripOverviewBento({ tripId }: { tripId: string }) {
  const { locale } = useAppLocale();
  const copy =
    locale === "zh-TW"
      ? {
          skeletonHero: "工作區載入中...",
          retry: "重試",
          failed: "旅程總覽載入失敗",
        }
      : COPY.en;
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const heroVariant: HeroVariant = useMemo(() => {
    const param = searchParams?.get("hero") as HeroVariant | null;
    return param && (HERO_VARIANTS as string[]).includes(param) ? param : "balanced";
  }, [searchParams]);

  const [data, setData] = useState<OverviewData | null>(() =>
    readAppBrowserCache<OverviewData>(OVERVIEW_CACHE_BUCKET, tripId, OVERVIEW_CACHE_MAX_AGE_MS)
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<TripItem | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const palette = useCommandPalette();

  const loadAll = useCallback(async () => {
    try {
      const [tripRes, board, members, expenses, votes, session] = await Promise.all([
        appFetchJson<{ trip: Trip; role: "organizer" | "member" }>(`/api/app/trips/${tripId}`),
        appFetchJson<BoardData>(`/api/app/trips/${tripId}/board`),
        appFetchJson<{ members: AppMember[] }>(`/api/app/trips/${tripId}/members`),
        appFetchJson<AppExpensesResponse>(`/api/app/trips/${tripId}/expenses`),
        appFetchJson<WebVotesResponse>(`/api/app/trips/${tripId}/votes`),
        appFetchJson<AppSessionResponse>(`/api/app/session`).catch(
          () => ({ lineUserId: "" }) as Pick<AppSessionResponse, "lineUserId">
        ),
      ]);
      setLoadError(null);
      const next: OverviewData = {
        board,
        members: members.members,
        expenses,
        trip: tripRes.trip,
        role: tripRes.role,
        votes,
        meLineUserId: session.lineUserId,
      };
      setData(next);
      writeAppBrowserCache(OVERVIEW_CACHE_BUCKET, tripId, next);
    } catch (err) {
      const message = err instanceof AppApiFetchError ? err.message : copy.failed;
      setLoadError(message);
    }
  }, [tripId, copy.failed]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (cancelled) return;
      await loadAll();
    })();
    return () => {
      cancelled = true;
    };
  }, [loadAll]);

  // Roving keyboard nav between bento tiles (j/k) + g-prefix nav.
  const tilesRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let pendingG = false;
    let pendingTimer: ReturnType<typeof setTimeout> | null = null;

    function focusTile(direction: 1 | -1) {
      const root = tilesRef.current;
      if (!root) return;
      const tiles = Array.from(root.querySelectorAll<HTMLElement>("[data-bento-tile]"));
      if (tiles.length === 0) return;
      const current = document.activeElement as HTMLElement | null;
      const currentIdx = current
        ? tiles.findIndex((t) => t === current || t.contains(current))
        : -1;
      const nextIdx =
        currentIdx < 0
          ? 0
          : Math.min(tiles.length - 1, Math.max(0, currentIdx + direction));
      tiles[nextIdx]?.focus();
    }

    function navTo(path: string) {
      router.push(path);
    }

    function handler(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const inField =
        !!target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);
      if (inField) return;

      if (pendingG) {
        const base = `/app/trips/${tripId}`;
        const map: Record<string, string> = {
          o: base,
          m: `${base}/map`,
          i: `${base}/itinerary`,
          d: `${base}/ideas`,
          v: `${base}/votes`,
          e: `${base}/expenses`,
          b: `${base}/board`,
          s: `${base}/settings`,
        };
        const dest = map[e.key.toLowerCase()];
        pendingG = false;
        if (dest) {
          e.preventDefault();
          navTo(dest);
          return;
        }
      }

      if (e.key === "g" && !e.metaKey && !e.ctrlKey) {
        pendingG = true;
        if (pendingTimer) clearTimeout(pendingTimer);
        pendingTimer = setTimeout(() => {
          pendingG = false;
        }, 800);
        return;
      }

      if (e.key === "j") {
        e.preventDefault();
        focusTile(1);
      } else if (e.key === "k") {
        e.preventDefault();
        focusTile(-1);
      } else if (e.key === "?") {
        e.preventDefault();
        palette.setOpen(true);
      }
    }

    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("keydown", handler);
      if (pendingTimer) clearTimeout(pendingTimer);
    };
  }, [router, tripId, palette]);

  if (loadError && !data) {
    return (
      <div className="rounded-2xl border border-[var(--status-blocked)] bg-[var(--status-blocked-soft)] px-4 py-4 text-sm text-[var(--status-blocked)]">
        {loadError}{" "}
        <button
          type="button"
          onClick={() => void loadAll()}
          className="ml-2 underline underline-offset-2"
        >
          {copy.retry}
        </button>
      </div>
    );
  }

  if (!data) {
    return <BentoSkeleton loadingLabel={copy.skeletonHero} />;
  }

  const { board, members, expenses, trip, role, votes, meLineUserId } = data;
  const isOrganizer = role === "organizer";

  const lineDeepLink: string | null = null; // The layout passes this when needed; bento doesn't depend on it.

  const allItems = [...board.todo, ...board.pending, ...board.confirmed];

  return (
    <>
      <CommandPalette
        tripId={tripId}
        open={palette.open}
        onOpenChange={palette.setOpen}
        onAddItem={() => setAddOpen(true)}
      />

      <div ref={tilesRef} className="bento">
        {/* Hero — large, top */}
        <div className="bento-hero" tabIndex={-1} data-bento-tile>
          <TripHeroTile
            variant={heroVariant}
            trip={trip}
            members={members}
            groupName={null}
            lineDeepLink={lineDeepLink}
            tripId={tripId}
            onPrimary={() => router.push(`/app/trips/${tripId}/publish`)}
          />
        </div>

        {/* Decision center — wide, side of hero */}
        <div className="bento-decision" tabIndex={-1} data-bento-tile>
          <DecisionCenterTile
            tripId={tripId}
            board={board}
            members={members}
            votes={votes.votes}
            onItemClick={setSelectedItem}
          />
        </div>

        {/* Finance — tall, right column */}
        <div className="bento-finance" tabIndex={-1} data-bento-tile>
          <FinanceTile
            tripId={tripId}
            expenses={expenses}
            memberCount={members.length}
            onSettleClick={() => router.push(`/app/trips/${tripId}/expenses`)}
          />
        </div>

        {/* Action queue — medium */}
        <div className="bento-action" tabIndex={-1} data-bento-tile>
          <ActionQueueTile
            tripId={tripId}
            board={board}
            votes={votes.votes}
            members={members}
            currentUserId={meLineUserId}
            onItemClick={setSelectedItem}
            onAfterNudge={() => void loadAll()}
          />
        </div>

        {/* Next up — medium */}
        <div className="bento-next" tabIndex={-1} data-bento-tile>
          <NextUpTile
            tripId={tripId}
            trip={trip}
            items={allItems}
            onItemClick={setSelectedItem}
          />
        </div>

        {/* AI updates — medium */}
        <div className="bento-ai" tabIndex={-1} data-bento-tile>
          <AIUpdatesTile
            board={board}
            onItemClick={setSelectedItem}
            onConfirm={(item) => {
              setSelectedItem(item);
            }}
          />
        </div>
      </div>

      {/* Hero variant picker — only visible when the ?hero= query is set */}
      {searchParams?.get("hero") && (
        <div className="surface-glass mt-6 flex items-center justify-center gap-2 rounded-full border border-[var(--border-hairline)] px-3 py-2 text-xs text-[var(--text-muted)]">
          <span className="text-caps">Hero</span>
          {HERO_VARIANTS.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => {
                const params = new URLSearchParams(searchParams.toString());
                params.set("hero", v);
                router.replace(`${pathname}?${params.toString()}`, { scroll: false });
              }}
              className={cn(
                "rounded-full px-3 py-1 font-semibold capitalize",
                v === heroVariant
                  ? "bg-[var(--text-primary)] text-[var(--surface-raised)]"
                  : "text-[var(--text-secondary)] hover:bg-[var(--surface-sunken)]"
              )}
            >
              {v}
            </button>
          ))}
        </div>
      )}

      <AddItemDialog
        tripId={tripId}
        open={addOpen}
        onOpenChange={setAddOpen}
        onCreated={() => {
          setAddOpen(false);
          void loadAll();
        }}
      />

      <ItemDetailDialog
        tripId={tripId}
        item={selectedItem}
        members={members}
        isOrganizer={isOrganizer}
        onOpenChange={(open) => {
          if (!open) setSelectedItem(null);
        }}
        onItemChanged={(updated) => {
          setSelectedItem(updated);
          void loadAll();
        }}
        onItemDeleted={() => {
          setSelectedItem(null);
          void loadAll();
        }}
      />

      <BentoStyles />
    </>
  );
}

/**
 * Bento grid CSS, scoped via a stylesheet tag because the spans are
 * non-trivial and clearer as a single grid-template than as 50 utility
 * classes. Mirrors the breakpoint rhythm in the brief
 * (390 / 768 / 1024 / 1280 / 1536).
 */
function BentoStyles() {
  return (
    <style>{`
      .bento {
        display: grid;
        grid-template-columns: repeat(12, minmax(0, 1fr));
        gap: 1rem;
      }
      .bento > * { min-width: 0; }
      .bento-hero, .bento-decision, .bento-finance,
      .bento-action, .bento-next, .bento-ai {
        grid-column: span 12;
        outline: none;
      }
      .bento-hero { min-height: 280px; }
      .bento-decision, .bento-finance, .bento-action, .bento-next, .bento-ai { min-height: 320px; }

      @media (min-width: 768px) {
        .bento { gap: 1.25rem; }
        .bento-finance { grid-column: span 6; }
        .bento-action  { grid-column: span 6; }
        .bento-next    { grid-column: span 6; }
        .bento-ai      { grid-column: span 6; }
      }
      @media (min-width: 1024px) {
        .bento-hero      { grid-column: span 12; }
        .bento-decision  { grid-column: span 7; }
        .bento-finance   { grid-column: span 5; grid-row: span 2; }
        .bento-action    { grid-column: span 7; }
        .bento-next      { grid-column: span 4; }
        .bento-ai        { grid-column: span 8; }
      }
      @media (min-width: 1280px) {
        .bento { gap: 1.5rem; }
        .bento-hero      { grid-column: span 7; grid-row: span 2; min-height: 360px; }
        .bento-decision  { grid-column: span 5; grid-row: span 1; }
        .bento-finance   { grid-column: span 5; grid-row: span 2; }
        .bento-action    { grid-column: span 7; grid-row: span 1; }
        .bento-next      { grid-column: span 5; grid-row: span 1; }
        .bento-ai        { grid-column: span 7; grid-row: span 1; }
      }

      .bento > *:focus-visible {
        outline: 2px solid var(--accent-line);
        outline-offset: 4px;
        border-radius: var(--radius-tile);
      }
      .bento > * > * { height: 100%; }
    `}</style>
  );
}

function BentoSkeleton({ loadingLabel }: { loadingLabel: string }) {
  return (
    <>
      <div className="bento">
        <div className="bento-hero skeleton rounded-[var(--radius-tile)]" style={{ minHeight: 360 }} aria-hidden />
        <div className="bento-decision skeleton rounded-[var(--radius-tile)]" aria-hidden />
        <div className="bento-finance skeleton rounded-[var(--radius-tile)]" aria-hidden />
        <div className="bento-action skeleton rounded-[var(--radius-tile)]" aria-hidden />
        <div className="bento-next skeleton rounded-[var(--radius-tile)]" aria-hidden />
        <div className="bento-ai skeleton rounded-[var(--radius-tile)]" aria-hidden />
      </div>
      <span className="sr-only">{loadingLabel}</span>
      <BentoStyles />
    </>
  );
}

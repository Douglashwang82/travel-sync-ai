"use client";

import { useCallback, useEffect, useState } from "react";
import { appFetchJson, AppApiFetchError } from "@/lib/app-client";
import { readAppBrowserCache, writeAppBrowserCache } from "@/lib/app-browser-cache";
import { Button } from "@/components/ui/button";
import type { BoardData, TripItem, Trip } from "@/lib/types";
import type { AppMember } from "@/app/api/app/trips/[tripId]/members/route";
import type { AppExpensesResponse } from "@/lib/app-trip-expenses";
import type { ItineraryResponse } from "@/app/api/app/trips/[tripId]/itinerary/route";
import type { WebVotesResponse } from "@/app/api/app/trips/[tripId]/votes/route";
import { ItemDetailDialog } from "@/components/app/item-detail-dialog";
import { AddItemDialog } from "@/components/app/add-item-dialog";
import { TripAIUpdates } from "@/components/app/trip-ai-updates";
import { TripFinancePanel } from "@/components/app/trip-finance-panel";
import { TripKpiStrip, type KpiTileSpec } from "@/components/app/trip-kpi-strip";
import { TripActionQueue } from "@/components/app/trip-action-queue";

interface OverviewData {
  board: BoardData;
  members: AppMember[];
  expenses: AppExpensesResponse;
  itinerary: ItineraryResponse;
  votes: WebVotesResponse;
  trip: Trip;
  role: "organizer" | "member";
}

const OVERVIEW_CACHE_BUCKET = "trip-overview";
const OVERVIEW_CACHE_MAX_AGE_MS = 60 * 1000;

export function TripOverview({ tripId }: { tripId: string }) {
  const [data, setData] = useState<OverviewData | null>(() =>
    readAppBrowserCache<OverviewData>(OVERVIEW_CACHE_BUCKET, tripId, OVERVIEW_CACHE_MAX_AGE_MS)
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<TripItem | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const loadAll = useCallback(async () => {
    try {
      const [tripRes, board, members, expenses, itinerary, votes] =
        await Promise.all([
          appFetchJson<{ trip: Trip; role: "organizer" | "member" }>(
            `/api/app/trips/${tripId}`
          ),
          appFetchJson<BoardData>(`/api/app/trips/${tripId}/board`),
          appFetchJson<{ members: AppMember[] }>(
            `/api/app/trips/${tripId}/members`
          ),
          appFetchJson<AppExpensesResponse>(
            `/api/app/trips/${tripId}/expenses`
          ),
          appFetchJson<ItineraryResponse>(
            `/api/app/trips/${tripId}/itinerary`
          ),
          appFetchJson<WebVotesResponse>(`/api/app/trips/${tripId}/votes`),
        ]);
      setLoadError(null);
      const nextData = {
        board,
        members: members.members,
        expenses,
        itinerary,
        votes,
        trip: tripRes.trip,
        role: tripRes.role,
      } satisfies OverviewData;
      setData(nextData);
      writeAppBrowserCache(OVERVIEW_CACHE_BUCKET, tripId, nextData);
    } catch (err) {
      const message =
        err instanceof AppApiFetchError
          ? err.message
          : "Failed to load trip overview";
      setLoadError(message);
    }
  }, [tripId]);

  useEffect(() => {
    void (async () => {
      await loadAll();
    })();
  }, [loadAll]);

  if (loadError && !data) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
        {loadError}{" "}
        <button
          type="button"
          onClick={() => void loadAll()}
          className="ml-2 underline underline-offset-2"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!data) {
    return <CommandCenterSkeleton />;
  }

  const { board, members, expenses, itinerary, votes, trip, role } = data;
  const isOrganizer = role === "organizer";
  const currentUserId = board.currentUser.lineUserId;

  const tiles = computeKpiTiles({
    trip,
    board,
    expenses,
    members,
    votes: votes.votes,
  });

  return (
    <>
      <div className="space-y-5">
        {isOrganizer && (
          <div className="flex justify-end">
            <Button size="sm" onClick={() => setAddOpen(true)}>
              + Add item
            </Button>
          </div>
        )}

        {/* Vital signs */}
        <TripKpiStrip tiles={tiles} />

        {/* Primary command surface */}
        <TripActionQueue
          tripId={tripId}
          board={board}
          votes={votes.votes}
          members={members}
          currentUserId={currentUserId}
          onItemClick={setSelectedItem}
          onAfterNudge={() => void loadAll()}
        />

        {/* Secondary panels */}
        <div className="grid gap-5 lg:grid-cols-2">
          <TripAIUpdates board={board} onItemClick={setSelectedItem} />
          <TripFinancePanel
            tripId={tripId}
            expenses={expenses}
            memberCount={members.length}
          />
        </div>

        {/* Tiny travelers footer — remains compact since header already shows
            the count and Settings tab manages the roster. */}
        <p className="text-center text-[11px] text-[var(--muted-foreground)]">
          {itinerary.items.length} item
          {itinerary.items.length === 1 ? "" : "s"} on the timeline ·{" "}
          {members.length} traveler{members.length === 1 ? "" : "s"} on this trip
        </p>
      </div>

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
    </>
  );
}

// ─── KPI computation ──────────────────────────────────────────────────────────

interface KpiArgs {
  trip: Trip;
  board: BoardData;
  expenses: AppExpensesResponse;
  members: AppMember[];
  votes: WebVotesResponse["votes"];
}

function computeKpiTiles({
  trip,
  board,
  expenses,
  votes,
}: KpiArgs): KpiTileSpec[] {
  const tiles: KpiTileSpec[] = [];

  // 1. Days to trip start (or "in trip" / "ended")
  if (trip.start_date) {
    const startMs = new Date(trip.start_date + "T00:00:00").getTime();
    const endMs = trip.end_date
      ? new Date(trip.end_date + "T23:59:59").getTime()
      : startMs;
    const now = Date.now();
    if (now < startMs) {
      const days = Math.ceil((startMs - now) / 86_400_000);
      tiles.push({
        label: "Trip starts",
        value: days === 0 ? "Today" : `${days}d`,
        hint: new Date(trip.start_date).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        }),
        icon: "✈",
        tone: days <= 7 ? "primary" : "default",
      });
    } else if (now <= endMs) {
      tiles.push({
        label: "Status",
        value: "In trip",
        hint: "Currently traveling",
        icon: "🌍",
        tone: "emerald",
      });
    } else {
      tiles.push({
        label: "Status",
        value: "Wrapped",
        hint: "Trip ended",
        icon: "🏁",
      });
    }
  } else {
    tiles.push({
      label: "Trip dates",
      value: "TBD",
      hint: "Pick start/end dates",
      icon: "📅",
      tone: "amber",
    });
  }

  // 2. Confirmed %
  const total =
    board.todo.length + board.pending.length + board.confirmed.length;
  const confirmedPct = total > 0
    ? Math.round((board.confirmed.length / total) * 100)
    : 0;
  tiles.push({
    label: "Confirmed",
    value: total > 0 ? `${confirmedPct}%` : "—",
    hint: `${board.confirmed.length}/${total} items`,
    icon: "✓",
    tone:
      confirmedPct >= 80
        ? "emerald"
        : confirmedPct >= 40
          ? "primary"
          : "default",
  });

  // 3. My open votes
  const myOpenVotes = votes.filter((v) => {
    const voted = v.options.some((o) => o.votedByMe);
    return !voted;
  }).length;
  tiles.push({
    label: "My votes",
    value: String(myOpenVotes),
    hint: myOpenVotes === 0 ? "All caught up" : "Need your vote",
    icon: "🗳",
    tone: myOpenVotes > 0 ? "amber" : "emerald",
  });

  // 4. Group blockers — votes still missing voters, plus to-dos w/o owner
  const blockingVotes = votes.filter((v) => v.totalVotes < v.memberCount).length;
  const ownerlessTodos = board.todo.filter(
    (i) => i.assigned_to_line_user_id == null
  ).length;
  const blockers = blockingVotes + ownerlessTodos;
  tiles.push({
    label: "Group blockers",
    value: String(blockers),
    hint:
      blockers === 0
        ? "Nothing waiting"
        : `${blockingVotes} vote${blockingVotes === 1 ? "" : "s"} · ${ownerlessTodos} unassigned`,
    icon: "⚠",
    tone: blockers > 0 ? "amber" : "emerald",
  });

  // 5. Bookings outstanding
  const bookingNeeded = board.confirmed.filter(
    (i) => i.booking_status === "needed"
  ).length;
  const bookingTotal = board.confirmed.filter(
    (i) => i.booking_status !== "not_required"
  ).length;
  tiles.push({
    label: "Bookings",
    value:
      bookingTotal > 0
        ? `${bookingTotal - bookingNeeded}/${bookingTotal}`
        : "—",
    hint: bookingNeeded === 0 ? "All booked" : `${bookingNeeded} to book`,
    icon: "📅",
    tone:
      bookingTotal === 0
        ? "default"
        : bookingNeeded === 0
          ? "emerald"
          : "primary",
  });

  // 6. Budget
  if (expenses.budgetAmount != null && expenses.budgetAmount > 0) {
    const pct = Math.min(
      999,
      Math.round((expenses.totalAmount / expenses.budgetAmount) * 100)
    );
    tiles.push({
      label: "Budget",
      value: `${pct}%`,
      hint: `${expenses.budgetCurrency} ${Math.round(expenses.totalAmount).toLocaleString()} / ${Math.round(expenses.budgetAmount).toLocaleString()}`,
      icon: "💰",
      tone: pct > 100 ? "red" : pct > 80 ? "amber" : "emerald",
    });
  } else {
    tiles.push({
      label: "Spent",
      value: `${expenses.budgetCurrency} ${Math.round(expenses.totalAmount).toLocaleString()}`,
      hint:
        expenses.settlements.length > 0
          ? `${expenses.settlements.length} unsettled`
          : "Everyone settled",
      icon: "💰",
      tone: expenses.settlements.length > 0 ? "amber" : "default",
    });
  }

  return tiles;
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function CommandCenterSkeleton() {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {[...Array(6)].map((_, i) => (
          <div
            key={i}
            className="h-20 animate-pulse rounded-2xl border border-[var(--border)] bg-[var(--secondary)]/40"
          />
        ))}
      </div>
      <div className="h-72 animate-pulse rounded-3xl border border-[var(--border)] bg-[var(--secondary)]/40" />
      <div className="grid animate-pulse gap-5 lg:grid-cols-2">
        <div className="h-56 rounded-3xl border border-[var(--border)] bg-[var(--secondary)]/40" />
        <div className="h-56 rounded-3xl border border-[var(--border)] bg-[var(--secondary)]/40" />
      </div>
    </div>
  );
}

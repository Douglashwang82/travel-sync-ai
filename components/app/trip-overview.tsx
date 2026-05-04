"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { appFetchJson, AppApiFetchError } from "@/lib/app-client";
import { readAppBrowserCache, writeAppBrowserCache } from "@/lib/app-browser-cache";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { BoardData, ItemType, TripItem } from "@/lib/types";
import type { AppMember } from "@/app/api/app/trips/[tripId]/members/route";
import type { AppExpensesResponse } from "@/lib/app-trip-expenses";
import type {
  ItineraryResponse,
} from "@/app/api/app/trips/[tripId]/itinerary/route";
import { BoardColumns, ITEM_TYPE_LABELS } from "@/components/app/board-columns";
import { ItemDetailDialog } from "@/components/app/item-detail-dialog";
import { AddItemDialog } from "@/components/app/add-item-dialog";

interface OverviewData {
  board: BoardData;
  members: AppMember[];
  expenses: AppExpensesResponse;
  itinerary: ItineraryResponse;
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
      const [tripRes, board, members, expenses, itinerary] = await Promise.all([
        appFetchJson<{ trip: unknown; role: "organizer" | "member" }>(`/api/app/trips/${tripId}`),
        appFetchJson<BoardData>(`/api/app/trips/${tripId}/board`),
        appFetchJson<{ members: AppMember[] }>(`/api/app/trips/${tripId}/members`),
        appFetchJson<AppExpensesResponse>(`/api/app/trips/${tripId}/expenses`),
        appFetchJson<ItineraryResponse>(`/api/app/trips/${tripId}/itinerary`),
      ]);
      setLoadError(null);
      const nextData = {
        board,
        members: members.members,
        expenses,
        itinerary,
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
    return <OverviewSkeleton />;
  }

  const { board, members, expenses, itinerary, role } = data;
  const isOrganizer = role === "organizer";
  const totalItems = board.todo.length + board.pending.length + board.confirmed.length;
  const bookedCount = board.confirmed.filter((i) => i.booking_status === "booked").length;
  const bookingNeeded = board.confirmed.filter((i) => i.booking_status === "needed").length;
  const nextItinerary = itinerary.items
    .filter((i) => i.stage === "confirmed" && i.deadline_at)
    .slice(0, 3);

  return (
    <>
      {loadError && (
        <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
          {loadError}. Showing your last loaded trip snapshot while we retry.
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-12">
        <section className="space-y-6 lg:col-span-8">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">Trip board</h2>
              <p className="text-xs text-[var(--muted-foreground)]">
                {totalItems} item{totalItems === 1 ? "" : "s"} across To-Do, Pending vote and
                Confirmed.
              </p>
            </div>
            {isOrganizer && (
              <Button size="sm" onClick={() => setAddOpen(true)}>
                + Add item
              </Button>
            )}
          </div>

          <BoardColumns
            board={board}
            members={members}
            onItemClick={setSelectedItem}
          />

          {nextItinerary.length > 0 && (
            <section className="rounded-2xl border border-[var(--border)] bg-[var(--background)] p-5">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold">Next up</h3>
                  <p className="text-xs text-[var(--muted-foreground)]">
                    Upcoming confirmed stops.
                  </p>
                </div>
                <Link
                  href={`/app/trips/${tripId}/itinerary`}
                  className="text-xs font-medium text-[var(--primary)] hover:underline"
                >
                  View itinerary
                </Link>
              </div>

              <ul className="mt-4 space-y-3">
                {nextItinerary.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-start gap-3 rounded-xl bg-[var(--secondary)]/60 px-3 py-2.5"
                  >
                    <div className="flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-lg bg-[var(--background)] text-center">
                      <span className="text-[10px] font-semibold uppercase text-[var(--muted-foreground)]">
                        {formatMonth(item.deadline_at)}
                      </span>
                      <span className="text-sm font-bold leading-none">
                        {formatDay(item.deadline_at)}
                      </span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{item.title}</p>
                      {item.confirmed_option?.address && (
                        <p className="truncate text-xs text-[var(--muted-foreground)]">
                          {item.confirmed_option.address}
                        </p>
                      )}
                    </div>
                    <Badge variant="secondary" className="text-[10px] uppercase">
                      {ITEM_TYPE_LABELS[item.item_type as ItemType] ?? "Item"}
                    </Badge>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </section>

        <aside className="space-y-4 lg:col-span-4">
          <div className="grid grid-cols-3 gap-3">
            <Stat label="To-Do" value={board.todo.length} tone="muted" />
            <Stat label="Pending" value={board.pending.length} tone="amber" />
            <Stat label="Confirmed" value={board.confirmed.length} tone="primary" />
          </div>

          <div className="rounded-2xl border border-[var(--border)] bg-[var(--background)] p-5">
            <h3 className="text-sm font-semibold">Booking progress</h3>
            <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
              {bookedCount} of {board.confirmed.length || 0} confirmed items booked.
            </p>
            {board.confirmed.length > 0 ? (
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--secondary)]">
                <div
                  className="h-full bg-[var(--primary)] transition-all"
                  style={{
                    width: `${(bookedCount / board.confirmed.length) * 100}%`,
                  }}
                />
              </div>
            ) : (
              <p className="mt-3 text-xs italic text-[var(--muted-foreground)]">
                No confirmed items yet.
              </p>
            )}
            {bookingNeeded > 0 && (
              <p className="mt-3 text-xs text-amber-700 dark:text-amber-300">
                {bookingNeeded} item{bookingNeeded === 1 ? "" : "s"} still need a booking.
              </p>
            )}
          </div>

          <div className="rounded-2xl border border-[var(--border)] bg-[var(--background)] p-5">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold">Expenses</h3>
                <p className="text-xs text-[var(--muted-foreground)]">
                  Total logged so far.
                </p>
              </div>
              <Link
                href={`/app/trips/${tripId}/expenses`}
                className="text-xs font-medium text-[var(--primary)] hover:underline"
              >
                Manage
              </Link>
            </div>
            <p className="mt-3 text-2xl font-bold">
              {expenses.budgetCurrency}
              {" "}
              {Math.round(expenses.totalAmount).toLocaleString()}
            </p>
            {expenses.budgetAmount !== null && (
              <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                Budget: {expenses.budgetCurrency} {expenses.budgetAmount.toLocaleString()}
              </p>
            )}
            {expenses.settlements.length > 0 ? (
              <ul className="mt-3 space-y-1 text-xs">
                {expenses.settlements.slice(0, 3).map((s, i) => (
                  <li key={i} className="flex items-center justify-between">
                    <span className="truncate">
                      <span className="font-medium">{s.from}</span>
                      <span className="text-[var(--muted-foreground)]"> → </span>
                      <span className="font-medium">{s.to}</span>
                    </span>
                    <span className="font-semibold text-red-500">
                      {expenses.budgetCurrency} {Math.round(s.amount).toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-xs italic text-[var(--muted-foreground)]">
                Everyone&apos;s settled.
              </p>
            )}
          </div>

          <div className="rounded-2xl border border-[var(--border)] bg-[var(--background)] p-5">
            <h3 className="text-sm font-semibold">Members</h3>
            <p className="text-xs text-[var(--muted-foreground)]">
              {members.length} traveler{members.length === 1 ? "" : "s"}.
            </p>
            <ul className="mt-3 space-y-2">
              {members.map((m) => (
                <li
                  key={m.lineUserId}
                  className="flex items-center gap-3 rounded-xl bg-[var(--secondary)]/60 px-3 py-2"
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--primary)]/10 text-xs font-semibold text-[var(--primary)]">
                    {(m.displayName ?? "?").slice(0, 1).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {m.displayName ?? "Unknown"}
                    </p>
                    <p className="truncate text-[10px] text-[var(--muted-foreground)]">
                      {m.lineUserId}
                    </p>
                  </div>
                  {m.role === "organizer" && (
                    <Badge variant="secondary" className="text-[10px] uppercase">
                      Organizer
                    </Badge>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </aside>
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

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "muted" | "amber" | "primary";
}) {
  const toneClass =
    tone === "primary"
      ? "text-[var(--primary)]"
      : tone === "amber"
        ? "text-amber-600 dark:text-amber-400"
        : "text-[var(--foreground)]";
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--background)] p-4">
      <p className={`text-xl font-bold ${toneClass}`}>{value}</p>
      <p className="mt-0.5 text-[11px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
        {label}
      </p>
    </div>
  );
}

function formatMonth(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { month: "short" });
}

function formatDay(iso: string | null): string {
  if (!iso) return "—";
  return String(new Date(iso).getDate());
}

function OverviewSkeleton() {
  return (
    <div className="grid animate-pulse gap-6 lg:grid-cols-12">
      <div className="space-y-3 lg:col-span-8">
        <div className="h-6 w-40 rounded-full bg-[var(--secondary)]" />
        <div className="grid gap-3 md:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-64 rounded-2xl border border-[var(--border)] bg-[var(--background)]"
            />
          ))}
        </div>
      </div>
      <div className="space-y-3 lg:col-span-4">
        <div className="h-20 rounded-2xl bg-[var(--secondary)]" />
        <div className="h-32 rounded-2xl bg-[var(--secondary)]" />
        <div className="h-48 rounded-2xl bg-[var(--secondary)]" />
      </div>
    </div>
  );
}

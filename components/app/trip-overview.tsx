"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { appFetchJson, AppApiFetchError } from "@/lib/app-client";
import { readAppBrowserCache, writeAppBrowserCache } from "@/lib/app-browser-cache";
import { Button } from "@/components/ui/button";
import type { BoardData, TripItem, Trip, ItemStage } from "@/lib/types";
import type { AppMember } from "@/app/api/app/trips/[tripId]/members/route";
import type { AppExpensesResponse } from "@/lib/app-trip-expenses";
import { ItemDetailDialog } from "@/components/app/item-detail-dialog";
import { AddItemDialog } from "@/components/app/add-item-dialog";

interface OverviewData {
  board: BoardData;
  members: AppMember[];
  expenses: AppExpensesResponse;
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
      const [tripRes, board, members, expenses] = await Promise.all([
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
      ]);
      setLoadError(null);
      const nextData = {
        board,
        members: members.members,
        expenses,
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
    return <EssentialsSkeleton />;
  }

  const { board, members, expenses, trip, role } = data;
  const isOrganizer = role === "organizer";

  const allItems = [...board.todo, ...board.pending, ...board.confirmed];
  const flightItems = allItems.filter((i) => i.item_type === "flight");
  const hotelItems = allItems.filter((i) => i.item_type === "hotel");
  const ticketItems = allItems.filter((i) => i.item_type === "activity");

  return (
    <>
      <div className="space-y-4">
        {isOrganizer && (
          <div className="flex justify-end">
            <Button size="sm" onClick={() => setAddOpen(true)}>
              + Add item
            </Button>
          </div>
        )}

        {/* Dates + Destination */}
        <div className="grid gap-4 sm:grid-cols-2">
          <EssentialCard icon="📅" label="Trip dates">
            {trip.start_date ? (
              <span>
                {fmtDate(trip.start_date)}
                {trip.end_date ? ` → ${fmtDate(trip.end_date)}` : ""}
              </span>
            ) : (
              <span className="text-[var(--muted-foreground)]">TBD</span>
            )}
          </EssentialCard>

          <EssentialCard icon="📍" label="Destination">
            {trip.destination_name ?? (
              <span className="text-[var(--muted-foreground)]">Not set</span>
            )}
          </EssentialCard>
        </div>

        {/* Budget */}
        <BudgetCard expenses={expenses} />

        {/* Optional: Flights */}
        {flightItems.length > 0 && (
          <ItemSection
            icon="✈"
            label="Flights"
            items={flightItems}
            onItemClick={setSelectedItem}
          />
        )}

        {/* Optional: Hotels */}
        {hotelItems.length > 0 && (
          <ItemSection
            icon="🏨"
            label="Hotels"
            items={hotelItems}
            onItemClick={setSelectedItem}
          />
        )}

        {/* Optional: Tickets */}
        {ticketItems.length > 0 && (
          <ItemSection
            icon="🎟"
            label="Tickets"
            items={ticketItems}
            onItemClick={setSelectedItem}
          />
        )}
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

// ─── Sub-components ───────────────────────────────────────────────────────────

function EssentialCard({
  icon,
  label,
  children,
}: {
  icon: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--background)] p-4">
      <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
        {icon} {label}
      </p>
      <div className="mt-1.5 text-base font-semibold text-[var(--foreground)]">
        {children}
      </div>
    </div>
  );
}

function BudgetCard({ expenses }: { expenses: AppExpensesResponse }) {
  const { budgetAmount, totalAmount, budgetCurrency } = expenses;
  const hasBudget = budgetAmount != null && budgetAmount > 0;
  const pct = hasBudget
    ? Math.min(999, Math.round((totalAmount / budgetAmount!) * 100))
    : null;

  const barColor =
    pct == null
      ? ""
      : pct > 100
        ? "bg-red-500"
        : pct > 80
          ? "bg-amber-400"
          : "bg-emerald-500";

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--background)] p-4">
      <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
        💰 Budget
      </p>
      <div className="mt-1.5">
        <p className="text-base font-semibold text-[var(--foreground)]">
          {budgetCurrency} {Math.round(totalAmount).toLocaleString()}
          {hasBudget && (
            <span className="font-normal text-[var(--muted-foreground)]">
              {" "}/ {Math.round(budgetAmount!).toLocaleString()}
            </span>
          )}
        </p>
        {hasBudget && pct != null && (
          <div className="mt-2">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--secondary)]">
              <div
                className={`h-full rounded-full transition-all ${barColor}`}
                style={{ width: `${Math.min(100, pct)}%` }}
              />
            </div>
            <p className="mt-1 text-[11px] text-[var(--muted-foreground)]">
              {pct}% of budget used
            </p>
          </div>
        )}
        {!hasBudget && (
          <p className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">
            No budget set
          </p>
        )}
      </div>
    </div>
  );
}

function ItemSection({
  icon,
  label,
  items,
  onItemClick,
}: {
  icon: string;
  label: string;
  items: TripItem[];
  onItemClick: (item: TripItem) => void;
}) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--background)] p-4">
      <p className="mb-3 text-[11px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
        {icon} {label} ({items.length})
      </p>
      <div className="space-y-2">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onItemClick(item)}
            className="flex w-full items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--secondary)]/30 px-3 py-2.5 text-left transition-colors hover:bg-[var(--secondary)]/60"
          >
            <StageDot stage={item.stage} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-[var(--foreground)]">
                {item.title}
              </span>
              {item.booking_status === "booked" && item.booking_ref && (
                <span className="text-[11px] text-emerald-600 dark:text-emerald-400">
                  Ref: {item.booking_ref}
                </span>
              )}
              {item.booking_status === "needed" && (
                <span className="text-[11px] text-amber-600 dark:text-amber-400">
                  Needs booking
                </span>
              )}
            </span>
            <StageBadge stage={item.stage} />
          </button>
        ))}
      </div>
    </div>
  );
}

function StageDot({ stage }: { stage: ItemStage }) {
  const colors: Record<ItemStage, string> = {
    todo: "bg-[var(--muted-foreground)]/50",
    pending: "bg-amber-400",
    confirmed: "bg-emerald-500",
  };
  return <span className={`h-2 w-2 shrink-0 rounded-full ${colors[stage]}`} />;
}

function StageBadge({ stage }: { stage: ItemStage }) {
  const styles: Record<ItemStage, string> = {
    todo: "bg-[var(--secondary)] text-[var(--muted-foreground)]",
    pending:
      "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300",
    confirmed:
      "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300",
  };
  const labels: Record<ItemStage, string> = {
    todo: "To-do",
    pending: "Pending",
    confirmed: "Confirmed",
  };
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${styles[stage]}`}
    >
      {labels[stage]}
    </span>
  );
}

function fmtDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function EssentialsSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="h-20 animate-pulse rounded-2xl border border-[var(--border)] bg-[var(--secondary)]/40" />
        <div className="h-20 animate-pulse rounded-2xl border border-[var(--border)] bg-[var(--secondary)]/40" />
      </div>
      <div className="h-24 animate-pulse rounded-2xl border border-[var(--border)] bg-[var(--secondary)]/40" />
    </div>
  );
}

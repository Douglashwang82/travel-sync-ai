"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { appFetchJson, AppApiFetchError } from "@/lib/app-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { BoardData, ItemType, TripItem } from "@/lib/types";
import type { AppMember } from "@/app/api/app/trips/[tripId]/members/route";
import type { AppExpensesResponse } from "@/lib/app-trip-expenses";
import type {
  ItineraryResponse,
} from "@/app/api/app/trips/[tripId]/itinerary/route";
import type { WebVotesResponse } from "@/app/api/app/trips/[tripId]/votes/route";
import { ItemDetailDialog } from "@/components/app/item-detail-dialog";
import { AddItemDialog } from "@/components/app/add-item-dialog";
import { ITEM_TYPE_LABELS } from "@/components/app/board-columns";
import { TripMapPanel } from "@/components/app/trip-map-panel";
import { TripDecisionCenter } from "@/components/app/trip-decision-center";
import { TripAIUpdates } from "@/components/app/trip-ai-updates";
import { TripFinancePanel } from "@/components/app/trip-finance-panel";

interface OverviewData {
  board: BoardData;
  members: AppMember[];
  expenses: AppExpensesResponse;
  itinerary: ItineraryResponse;
  votes: WebVotesResponse;
  trip: {
    destination_name: string | null;
    destination_lat: number | null;
    destination_lng: number | null;
  };
  role: "organizer" | "member";
}

export function TripOverview({ tripId }: { tripId: string }) {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<TripItem | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const loadAll = useCallback(async () => {
    try {
      const [tripRes, board, members, expenses, itinerary, votes] =
        await Promise.all([
          appFetchJson<{
            trip: {
              destination_name: string | null;
              destination_lat: number | null;
              destination_lng: number | null;
            };
            role: "organizer" | "member";
          }>(`/api/app/trips/${tripId}`),
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
      setData({
        board,
        members: members.members,
        expenses,
        itinerary,
        votes,
        trip: tripRes.trip,
        role: tripRes.role,
      });
    } catch (err) {
      setLoadError(
        err instanceof AppApiFetchError
          ? err.message
          : "Failed to load trip overview"
      );
    }
  }, [tripId]);

  useEffect(() => {
    void (async () => {
      await loadAll();
    })();
  }, [loadAll]);

  if (loadError) {
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

  const { board, members, expenses, itinerary, votes, trip, role } = data;
  const isOrganizer = role === "organizer";
  const nextItinerary = itinerary.items
    .filter((i) => i.stage === "confirmed" && i.deadline_at)
    .slice(0, 4);

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

        {/* Map — full-page primary surface */}
        <TripMapPanel
          itinerary={itinerary}
          destination={{
            name: trip.destination_name,
            lat: trip.destination_lat,
            lng: trip.destination_lng,
          }}
        />

        {/* Timeline */}
        <NextUpTimeline
          tripId={tripId}
          items={nextItinerary}
          total={itinerary.items.length}
        />

        {/* Decision center */}
        <TripDecisionCenter
          tripId={tripId}
          board={board}
          members={members}
          votes={votes.votes}
          onItemClick={setSelectedItem}
        />

        {/* AI updates + finance summary */}
        <div className="grid gap-5 lg:grid-cols-2">
          <TripAIUpdates board={board} onItemClick={setSelectedItem} />
          <TripFinancePanel
            tripId={tripId}
            expenses={expenses}
            memberCount={members.length}
          />
        </div>

        {/* Members strip */}
        <MembersStrip members={members} />
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

function NextUpTimeline({
  tripId,
  items,
  total,
}: {
  tripId: string;
  items: ItineraryResponse["items"];
  total: number;
}) {
  return (
    <section className="flex h-full flex-col rounded-3xl border border-[var(--border)] bg-[var(--background)] p-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold">Next up</h2>
          <p className="text-[11px] text-[var(--muted-foreground)]">
            Upcoming confirmed stops · {total} total
          </p>
        </div>
        <Link
          href={`/app/trips/${tripId}/itinerary`}
          className="text-xs font-medium text-[var(--primary)] hover:underline"
        >
          Full timeline →
        </Link>
      </div>

      {items.length === 0 ? (
        <div className="mt-4 flex flex-1 items-center justify-center rounded-2xl border border-dashed border-[var(--border)] px-4 py-6 text-center text-xs text-[var(--muted-foreground)]">
          Nothing confirmed with a date yet. Confirm an item to see it here.
        </div>
      ) : (
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-start gap-3 rounded-xl bg-[var(--secondary)]/40 px-3 py-2.5"
            >
              <div className="flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-lg bg-[var(--background)] text-center shadow-sm">
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
                  <p className="truncate text-[11px] text-[var(--muted-foreground)]">
                    📍 {item.confirmed_option.address}
                  </p>
                )}
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <Badge
                    variant="secondary"
                    className="text-[9px] uppercase"
                  >
                    {ITEM_TYPE_LABELS[item.item_type as ItemType] ?? "Item"}
                  </Badge>
                  {item.deadline_at && (
                    <span className="text-[10px] text-[var(--muted-foreground)]">
                      {new Date(item.deadline_at).toLocaleTimeString(
                        undefined,
                        {
                          hour: "2-digit",
                          minute: "2-digit",
                        }
                      )}
                    </span>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function MembersStrip({ members }: { members: AppMember[] }) {
  return (
    <section className="rounded-3xl border border-[var(--border)] bg-[var(--background)] px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Travelers</h3>
          <p className="text-[11px] text-[var(--muted-foreground)]">
            {members.length} member{members.length === 1 ? "" : "s"} on this trip
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {members.map((m) => (
            <span
              key={m.lineUserId}
              className="inline-flex items-center gap-1.5 rounded-full bg-[var(--secondary)]/60 px-2 py-1 text-xs"
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--primary)]/10 text-[10px] font-semibold text-[var(--primary)]">
                {(m.displayName ?? "?").slice(0, 1).toUpperCase()}
              </span>
              <span className="font-medium">
                {m.displayName ?? "Unknown"}
              </span>
              {m.role === "organizer" && (
                <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                  Lead
                </span>
              )}
            </span>
          ))}
        </div>
      </div>
    </section>
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
    <div className="space-y-5">
      <div className="grid animate-pulse gap-5 lg:grid-cols-12">
        <div className="lg:col-span-8">
          <div className="h-[28rem] rounded-3xl border border-[var(--border)] bg-[var(--secondary)]/30" />
        </div>
        <div className="lg:col-span-4">
          <div className="h-[28rem] rounded-3xl border border-[var(--border)] bg-[var(--secondary)]/30" />
        </div>
      </div>
      <div className="h-48 animate-pulse rounded-3xl border border-[var(--border)] bg-[var(--secondary)]/30" />
      <div className="grid animate-pulse gap-5 lg:grid-cols-2">
        <div className="h-56 rounded-3xl border border-[var(--border)] bg-[var(--secondary)]/30" />
        <div className="h-56 rounded-3xl border border-[var(--border)] bg-[var(--secondary)]/30" />
      </div>
    </div>
  );
}

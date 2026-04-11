"use client";

import { useEffect, useState } from "react";
import {
  LoadingSpinner,
  TimelineSkeleton,
  ErrorScreen,
  EmptyState,
} from "@/components/liff/shared";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { liffFetch } from "@/lib/liff-client";
import { toLiffErrorMessage } from "@/lib/liff-errors";
import { useLiffSession } from "@/lib/use-liff-session";
import type { ItineraryItem } from "@/app/api/liff/itinerary/route";

type Trip = {
  id: string;
  destination_name: string;
  start_date: string | null;
  end_date: string | null;
};

const ITEM_TYPE_EMOJI: Record<string, string> = {
  hotel: "Hotel",
  restaurant: "Food",
  activity: "Plan",
  transport: "Ride",
  flight: "Flight",
  insurance: "Cover",
  other: "Item",
};

export default function ItineraryPage() {
  const {
    isReady,
    isLoggedIn,
    error,
    session,
    sessionLoading,
    sessionError,
    reloadSession,
  } = useLiffSession();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [items, setItems] = useState<ItineraryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  async function loadItinerary() {
    setLoading(true);
    setLoadError(null);

    try {
      const sessionData = await reloadSession();
      if (!sessionData) throw new Error("Failed to load session");

      if (!sessionData.activeTrip) {
        setTrip(null);
        setItems([]);
        return;
      }

      const res = await liffFetch(`/api/liff/itinerary?tripId=${sessionData.activeTrip.id}`);
      if (!res.ok) throw new Error("Failed to load itinerary");

      const data = await res.json();
      setTrip(data.trip);
      setItems(data.items);
    } catch (err) {
      setLoadError(
        toLiffErrorMessage(
          "itinerary",
          err,
          "We could not load the itinerary. Reopen this page in LINE and try again."
        )
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!isReady || !isLoggedIn || !session || sessionLoading) return;

    if (!session.activeTrip) {
      setTrip(null);
      setItems([]);
      return;
    }

    void (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const res = await liffFetch(`/api/liff/itinerary?tripId=${session.activeTrip!.id}`);
        if (!res.ok) throw new Error("Failed to load itinerary");

        const data = await res.json();
        setTrip(data.trip);
        setItems(data.items);
      } catch (err) {
        setLoadError(
          toLiffErrorMessage(
            "itinerary",
            err,
            "We could not load the itinerary. Reopen this page in LINE and try again."
          )
        );
      } finally {
        setLoading(false);
      }
    })();
  }, [isReady, isLoggedIn, session, sessionLoading]);

  if (!isReady) return <LoadingSpinner message="Initializing..." />;
  if (error) return <ErrorScreen message={error} />;
  if (!isLoggedIn) return <LoadingSpinner message="Logging in..." />;
  if (sessionLoading && !session) return <TimelineSkeleton />;
  if (sessionError && !session) return <ErrorScreen message={sessionError} onRetry={loadItinerary} />;
  if (loading) return <TimelineSkeleton />;
  if (loadError) return <ErrorScreen message={loadError} onRetry={loadItinerary} />;

  if (!trip) {
    return (
      <EmptyState
        emoji="Map"
        title="No active trip"
        description={
          <>
            Type <code className="font-mono bg-[var(--secondary)] px-1 py-0.5 rounded text-xs">/start</code>{" "}
            in the group chat to begin.
          </>
        }
      />
    );
  }

  if (items.length === 0) {
    return (
      <div className="max-w-md mx-auto">
        <TripHeader trip={trip} />
        <EmptyState
          emoji="Soon"
          title="No confirmed items yet"
          description={
            <>
              Use <code className="font-mono text-xs">/vote</code> in chat to start deciding.
              Confirmed items will appear here.
            </>
          }
        />
      </div>
    );
  }

  const grouped = groupByDate(items);

  return (
    <div className="max-w-md mx-auto">
      <TripHeader trip={trip} />

      <div className="px-4 pb-3 flex gap-4 text-xs text-[var(--muted-foreground)]">
        <span className="text-[var(--primary)] font-semibold">{items.length} confirmed</span>
        {grouped.length > 1 && <span>{grouped.length} days</span>}
      </div>

      <div className="px-4 pb-4 space-y-6">
        {grouped.map(({ date, label, dayItems }) => (
          <div key={date}>
            <div className="flex items-center gap-3 mb-3">
              <div className="h-px flex-1 bg-[var(--border)]" />
              <span className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wide whitespace-nowrap">
                {label}
              </span>
              <div className="h-px flex-1 bg-[var(--border)]" />
            </div>

            <div className="space-y-3">
              {dayItems.map((item) => (
                <ItineraryCard key={item.id} item={item} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function groupByDate(items: ItineraryItem[]) {
  const map = new Map<string, { label: string; dayItems: ItineraryItem[] }>();

  for (const item of items) {
    let key = "no-date";
    let label = "No date set";

    if (item.deadline_at) {
      const d = new Date(item.deadline_at);
      key = d.toISOString().split("T")[0];
      label = d.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        weekday: "short",
      });
    }

    if (!map.has(key)) map.set(key, { label, dayItems: [] });
    map.get(key)!.dayItems.push(item);
  }

  return Array.from(map.entries()).map(([date, value]) => ({ date, ...value }));
}

function TripHeader({ trip }: { trip: Trip }) {
  return (
    <div className="sticky top-0 z-10 bg-[var(--background)] border-b border-[var(--border)] px-4 py-3">
      <h1 className="font-bold text-base">{trip.destination_name}</h1>
      {trip.start_date && trip.end_date && (
        <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
          {trip.start_date} to {trip.end_date}
        </p>
      )}
    </div>
  );
}

function ItineraryCard({ item }: { item: ItineraryItem }) {
  const badge = ITEM_TYPE_EMOJI[item.item_type] ?? "Item";
  const option = item.confirmed_option;

  return (
    <div className="rounded-2xl border border-[var(--border)] overflow-hidden">
      {option?.image_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={option.image_url} alt={option.name} className="w-full h-36 object-cover" />
      )}

      <div className="p-4 space-y-2">
        <div className="flex items-start gap-2.5">
          <Badge variant="secondary" className="shrink-0">
            {badge}
          </Badge>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm leading-snug">{item.title}</p>
            {option && option.name !== item.title && (
              <p className="text-xs text-[var(--muted-foreground)] mt-0.5">{option.name}</p>
            )}
          </div>
          {option?.rating && (
            <Badge variant="secondary" className="text-xs shrink-0">
              {option.rating}
            </Badge>
          )}
        </div>

        {option?.address && (
          <div className="pl-8">
            <p className="text-xs text-[var(--muted-foreground)] leading-relaxed">{option.address}</p>
          </div>
        )}

        {(option?.price_level || option?.booking_url) && (
          <div className={cn("flex items-center gap-3 pl-8")}>
            {option.price_level && (
              <span className="text-xs text-[var(--muted-foreground)]">{option.price_level}</span>
            )}
            {option.booking_url && (
              <a
                href={option.booking_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-medium text-[var(--primary)] underline underline-offset-2"
              >
                Book
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

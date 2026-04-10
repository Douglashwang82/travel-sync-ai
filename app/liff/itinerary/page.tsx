"use client";

import { useEffect, useState, useCallback } from "react";
import { useLiff } from "@/components/liff-provider";
import {
  LoadingSpinner,
  TimelineSkeleton,
  ErrorScreen,
  EmptyState,
} from "@/components/liff/shared";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { liffFetch } from "@/lib/liff-client";
import type { ItineraryItem } from "@/app/api/liff/itinerary/route";

type Trip = {
  id: string;
  destination_name: string;
  start_date: string | null;
  end_date: string | null;
};

const ITEM_TYPE_EMOJI: Record<string, string> = {
  hotel: "🏨",
  restaurant: "🍽️",
  activity: "🎯",
  transport: "🚌",
  flight: "✈️",
  insurance: "🛡️",
  other: "📌",
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ItineraryPage() {
  const { isReady, isLoggedIn, profile, lineGroupId, error } = useLiff();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [items, setItems] = useState<ItineraryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadItinerary = useCallback(async () => {
    if (!profile || !lineGroupId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const sessionRes = await liffFetch(
        `/api/liff/session?lineGroupId=${encodeURIComponent(lineGroupId)}&lineUserId=${encodeURIComponent(profile.userId)}`
      );
      if (!sessionRes.ok) throw new Error("Failed to load session");
      const session = await sessionRes.json();

      if (!session.activeTrip) {
        setTrip(null);
        setItems([]);
        return;
      }

      const res = await liffFetch(`/api/liff/itinerary?tripId=${session.activeTrip.id}`);
      if (!res.ok) throw new Error("Failed to load itinerary");
      const data = await res.json();
      setTrip(data.trip);
      setItems(data.items);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [profile, lineGroupId]);

  useEffect(() => {
    if (isReady && isLoggedIn) loadItinerary();
  }, [isReady, isLoggedIn, loadItinerary]);

  if (!isReady)      return <LoadingSpinner message="Initializing…" />;
  if (error)         return <ErrorScreen message={error} />;
  if (!isLoggedIn)   return <LoadingSpinner message="Logging in…" />;
  if (loading)       return <TimelineSkeleton />;
  if (loadError)     return <ErrorScreen message={loadError} onRetry={loadItinerary} />;

  if (!trip) {
    return (
      <EmptyState
        emoji="🗺️"
        title="No active trip"
        description={
          <>
            Type{" "}
            <code className="font-mono bg-[var(--secondary)] px-1 py-0.5 rounded text-xs">
              /start
            </code>{" "}
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
          emoji="⏳"
          title="No confirmed items yet"
          description={
            <>
              Use <code className="font-mono text-xs">/vote</code> in chat to
              start deciding. Confirmed items will appear here.
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

      {/* Stats bar */}
      <div className="px-4 pb-3 flex gap-4 text-xs text-[var(--muted-foreground)]">
        <span className="text-[var(--primary)] font-semibold">{items.length} confirmed</span>
        {grouped.length > 1 && <span>{grouped.length} days</span>}
      </div>

      {/* Timeline */}
      <div className="px-4 pb-4 space-y-6">
        {grouped.map(({ date, label, dayItems }) => (
          <div key={date}>
            {/* Date header */}
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

  return Array.from(map.entries()).map(([date, val]) => ({ date, ...val }));
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function TripHeader({ trip }: { trip: Trip }) {
  return (
    <div className="sticky top-0 z-10 bg-[var(--background)] border-b border-[var(--border)] px-4 py-3">
      <h1 className="font-bold text-base">🗺️ {trip.destination_name}</h1>
      {trip.start_date && trip.end_date && (
        <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
          {trip.start_date} → {trip.end_date}
        </p>
      )}
    </div>
  );
}

function ItineraryCard({ item }: { item: ItineraryItem }) {
  const emoji = ITEM_TYPE_EMOJI[item.item_type] ?? "📌";
  const opt = item.confirmed_option;

  return (
    <div className="rounded-2xl border border-[var(--border)] overflow-hidden">
      {/* Image */}
      {opt?.image_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={opt.image_url}
          alt={opt.name}
          className="w-full h-36 object-cover"
        />
      )}

      <div className="p-4 space-y-2">
        {/* Title row */}
        <div className="flex items-start gap-2.5">
          <span className="text-xl leading-none mt-0.5 shrink-0">{emoji}</span>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm leading-snug">{item.title}</p>
            {opt && opt.name !== item.title && (
              <p className="text-xs text-[var(--muted-foreground)] mt-0.5">{opt.name}</p>
            )}
          </div>
          {opt?.rating && (
            <Badge variant="secondary" className="text-xs shrink-0">
              ⭐ {opt.rating}
            </Badge>
          )}
        </div>

        {/* Address */}
        {opt?.address && (
          <div className="flex items-start gap-1.5 pl-8">
            <span className="text-xs text-[var(--muted-foreground)] shrink-0">📍</span>
            <p className="text-xs text-[var(--muted-foreground)] leading-relaxed">{opt.address}</p>
          </div>
        )}

        {/* Price + booking */}
        {(opt?.price_level || opt?.booking_url) && (
          <div className={cn("flex items-center gap-3 pl-8")}>
            {opt.price_level && (
              <span className="text-xs text-[var(--muted-foreground)]">{opt.price_level}</span>
            )}
            {opt.booking_url && (
              <a
                href={opt.booking_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-medium text-[var(--primary)] underline underline-offset-2"
              >
                Book →
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}


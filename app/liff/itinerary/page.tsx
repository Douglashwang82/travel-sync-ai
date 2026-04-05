"use client";

import { useEffect, useState, useCallback } from "react";
import { useLiff } from "@/components/liff-provider";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
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
      const sessionRes = await fetch(
        `/api/liff/session?lineGroupId=${encodeURIComponent(lineGroupId)}&lineUserId=${encodeURIComponent(profile.userId)}`
      );
      if (!sessionRes.ok) throw new Error("Failed to load session");
      const session = await sessionRes.json();

      if (!session.activeTrip) {
        setTrip(null);
        setItems([]);
        return;
      }

      const res = await fetch(`/api/liff/itinerary?tripId=${session.activeTrip.id}`);
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

  if (!isReady) return <LoadingScreen />;
  if (error) return <ErrorScreen message={error} />;
  if (!isLoggedIn) return <LoadingScreen />;
  if (loading) return <LoadingScreen />;
  if (loadError) return <ErrorScreen message={loadError} onRetry={loadItinerary} />;

  if (!trip) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-6 text-center">
        <p className="text-4xl mb-3">🗺️</p>
        <h2 className="text-lg font-semibold mb-1">No active trip</h2>
        <p className="text-sm text-muted-foreground">
          Type <span className="font-mono bg-secondary px-1 rounded">/start</span> in the group chat to begin.
        </p>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="max-w-md mx-auto p-4 pt-6 space-y-4">
        <TripHeader trip={trip} />
        <Separator />
        <div className="flex flex-col items-center py-12 text-center">
          <p className="text-3xl mb-3">⏳</p>
          <p className="text-sm text-muted-foreground">
            No confirmed items yet.<br />
            Use <span className="font-mono">/vote</span> in chat to start deciding.
          </p>
        </div>
      </div>
    );
  }

  // Group items by date if deadline_at is set, otherwise "No date"
  const grouped = groupByDate(items);

  return (
    <div className="max-w-md mx-auto p-4 pb-24 space-y-4">
      <TripHeader trip={trip} />
      <Separator />

      {grouped.map(({ date, label, dayItems }) => (
        <div key={date} className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-1">
            {label}
          </p>
          {dayItems.map((item) => (
            <ItineraryCard key={item.id} item={item} />
          ))}
        </div>
      ))}
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
      label = d.toLocaleDateString("zh-TW", {
        month: "long",
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
    <div className="pt-4">
      <h1 className="text-xl font-bold">🗺️ {trip.destination_name}</h1>
      {trip.start_date && trip.end_date && (
        <p className="text-sm text-muted-foreground mt-0.5">
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
    <Card className="overflow-hidden">
      {opt?.image_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={opt.image_url}
          alt={opt.name}
          className="w-full h-32 object-cover"
        />
      )}
      <CardContent className="p-3 space-y-1.5">
        <div className="flex items-start gap-2">
          <span className="text-base leading-none mt-0.5">{emoji}</span>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm leading-snug">{item.title}</p>
            {opt && opt.name !== item.title && (
              <p className="text-xs text-muted-foreground">{opt.name}</p>
            )}
          </div>
          {opt?.rating && (
            <Badge variant="secondary" className="text-xs shrink-0">
              ⭐ {opt.rating}
            </Badge>
          )}
        </div>

        {opt?.address && (
          <p className="text-xs text-muted-foreground pl-6 truncate">{opt.address}</p>
        )}

        <div className={cn("flex items-center gap-2 pl-6", !opt?.price_level && !opt?.booking_url && "hidden")}>
          {opt?.price_level && (
            <span className="text-xs text-muted-foreground">{opt.price_level}</span>
          )}
          {opt?.booking_url && (
            <a
              href={opt.booking_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-primary underline underline-offset-2"
            >
              Book →
            </a>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function LoadingScreen() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-3">
      <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      <p className="text-sm text-muted-foreground">Loading itinerary...</p>
    </div>
  );
}

function ErrorScreen({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-6 text-center gap-3">
      <p className="text-2xl">⚠️</p>
      <p className="text-sm text-muted-foreground">{message}</p>
      {onRetry && (
        <button onClick={onRetry} className="text-sm text-primary underline underline-offset-2">
          Tap to retry
        </button>
      )}
    </div>
  );
}

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
import type { RouteData, RouteStop } from "@/app/api/liff/route/route";

const ITEM_TYPE_LABEL: Record<string, string> = {
  hotel: "Hotel",
  restaurant: "Food",
  activity: "Activity",
  transport: "Ride",
  flight: "Flight",
  insurance: "Cover",
  other: "Other",
};

export default function RoutePage() {
  const { isReady, isLoggedIn, error, session, sessionLoading, sessionError, reloadSession } =
    useLiffSession();
  const [routeData, setRouteData] = useState<RouteData | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  async function loadRoute() {
    setLoading(true);
    setLoadError(null);

    try {
      const sessionData = await reloadSession();
      if (!sessionData) throw new Error("Failed to load session");

      if (!sessionData.activeTrip) {
        setRouteData(null);
        return;
      }

      const res = await liffFetch(`/api/liff/route?tripId=${sessionData.activeTrip.id}`);
      if (!res.ok) throw new Error("Failed to load route");
      setRouteData(await res.json());
    } catch (err) {
      setLoadError(
        toLiffErrorMessage(
          "route",
          err,
          "We could not load the route. Reopen this page in LINE and try again."
        )
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!isReady || !isLoggedIn || !session || sessionLoading) return;

    if (!session.activeTrip) {
      setRouteData(null);
      return;
    }

    void (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const res = await liffFetch(`/api/liff/route?tripId=${session.activeTrip!.id}`);
        if (!res.ok) throw new Error("Failed to load route");
        setRouteData(await res.json());
      } catch (err) {
        setLoadError(
          toLiffErrorMessage(
            "route",
            err,
            "We could not load the route. Reopen this page in LINE and try again."
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
  if (sessionError && !session) return <ErrorScreen message={sessionError} onRetry={loadRoute} />;
  if (loading) return <TimelineSkeleton />;
  if (loadError) return <ErrorScreen message={loadError} onRetry={loadRoute} />;

  if (!routeData) {
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

  const { trip, stops, unrouted } = routeData;

  if (stops.length === 0 && unrouted.length === 0) {
    return (
      <div className="max-w-md mx-auto">
        <RouteHeader trip={trip} />
        <EmptyState
          emoji="Soon"
          title="No confirmed stops yet"
          description={
            <>
              Confirmed items with map locations will appear here in optimised visit order.
            </>
          }
        />
      </div>
    );
  }

  const totalDistanceKm = stops.reduce((sum, s) => sum + (s.distance_from_prev_km ?? 0), 0);

  return (
    <div className="max-w-md mx-auto">
      <RouteHeader trip={trip} />

      <div className="px-4 pb-3 flex gap-4 text-xs text-[var(--muted-foreground)]">
        {stops.length > 0 && (
          <span className="text-[var(--primary)] font-semibold">
            {stops.length} stop{stops.length !== 1 ? "s" : ""}
          </span>
        )}
        {totalDistanceKm > 0 && (
          <span>~{Math.round(totalDistanceKm)} km total</span>
        )}
        {unrouted.length > 0 && (
          <span>{unrouted.length} without location</span>
        )}
      </div>

      {stops.length > 0 && (
        <div className="px-4 pb-4 space-y-0">
          {stops.map((stop, idx) => (
            <StopCard key={stop.id} stop={stop} index={idx} isLast={idx === stops.length - 1} />
          ))}
        </div>
      )}

      {unrouted.length > 0 && (
        <div className="px-4 pb-4">
          <div className="rounded-2xl border border-[var(--border)] overflow-hidden">
            <div className="px-4 py-2.5 bg-[var(--secondary)] dark:bg-[#111]">
              <p className="text-sm font-semibold text-[var(--muted-foreground)]">
                No location data
              </p>
            </div>
            <div className="divide-y divide-[var(--border)]">
              {unrouted.map((item) => (
                <div key={item.id} className="px-4 py-3 flex items-center gap-3">
                  <Badge variant="secondary" className="text-[10px] shrink-0">
                    {ITEM_TYPE_LABEL[item.item_type] ?? "Item"}
                  </Badge>
                  <span className="text-sm text-[var(--muted-foreground)] truncate">
                    {item.title}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RouteHeader({
  trip,
}: {
  trip: RouteData["trip"];
}) {
  return (
    <div className="sticky top-0 z-10 bg-[var(--background)] border-b border-[var(--border)] px-4 py-3">
      <h1 className="font-bold text-base">{trip.destination_name ?? "New trip"}</h1>
      {trip.start_date && trip.end_date && (
        <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
          {trip.start_date} to {trip.end_date}
        </p>
      )}
      <p className="text-[11px] text-[var(--muted-foreground)] mt-1">
        Optimised visit order — nearest stop first
      </p>
    </div>
  );
}

function StopCard({
  stop,
  index,
  isLast,
}: {
  stop: RouteStop;
  index: number;
  isLast: boolean;
}) {
  const opt = stop.confirmed_option;

  return (
    <div className="relative flex gap-3">
      {/* Timeline line */}
      <div className="flex flex-col items-center">
        <div className="w-7 h-7 rounded-full bg-[var(--primary)] text-white flex items-center justify-center text-xs font-bold shrink-0 z-10">
          {index + 1}
        </div>
        {!isLast && (
          <div className="w-px flex-1 bg-[var(--border)] my-1" />
        )}
      </div>

      <div className={cn("flex-1 pb-4", isLast && "pb-0")}>
        {/* Distance connector */}
        {stop.distance_from_prev_km != null && stop.distance_from_prev_km > 0 && (
          <p className="text-[10px] text-[var(--muted-foreground)] mb-1 -mt-0.5">
            {stop.distance_from_prev_km} km from prev
          </p>
        )}

        <div className="rounded-2xl border border-[var(--border)] overflow-hidden">
          <div className="p-3 space-y-1.5">
            <div className="flex items-start gap-2">
              <Badge variant="secondary" className="text-[10px] shrink-0 mt-0.5">
                {ITEM_TYPE_LABEL[stop.item_type] ?? "Item"}
              </Badge>
              <p className="text-sm font-semibold leading-snug">{stop.title}</p>
            </div>

            {opt?.address && (
              <p className="text-xs text-[var(--muted-foreground)] leading-relaxed pl-8">
                {opt.address}
              </p>
            )}

            {opt?.google_maps_url && (
              <div className="pl-8">
                <a
                  href={opt.google_maps_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-medium text-[var(--primary)] underline underline-offset-2"
                >
                  Open in Maps
                </a>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

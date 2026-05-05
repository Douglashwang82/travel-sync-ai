"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import type {
  ItineraryEntry,
  ItineraryResponse,
} from "@/app/api/app/trips/[tripId]/itinerary/route";

const TYPE_ICON: Record<string, string> = {
  hotel: "🏨",
  restaurant: "🍽️",
  activity: "🎯",
  transport: "🚌",
  flight: "✈️",
  insurance: "🛡️",
  other: "📌",
};

const TYPE_LABEL: Record<string, string> = {
  hotel: "Hotel",
  restaurant: "Food",
  activity: "Activity",
  transport: "Transit",
  flight: "Flight",
  insurance: "Insurance",
  other: "Item",
};

const STAGE_TONE: Record<string, string> = {
  confirmed:
    "bg-[#dcfce7] text-[#166534] dark:bg-[#14532d] dark:text-[#86efac]",
  pending:
    "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  todo: "bg-[var(--secondary)] text-[var(--muted-foreground)]",
};

type TypeFilter =
  | "all"
  | "hotel"
  | "restaurant"
  | "activity"
  | "transport"
  | "confirmed"
  | "pending";

const FILTERS: Array<{ value: TypeFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "hotel", label: "Hotels" },
  { value: "restaurant", label: "Food" },
  { value: "activity", label: "Activities" },
  { value: "transport", label: "Transit" },
  { value: "confirmed", label: "Confirmed" },
  { value: "pending", label: "Pending vote" },
];

interface MappedItem extends ItineraryEntry {
  lat: number;
  lng: number;
}

export function TripMapPanel({
  itinerary,
  destination,
}: {
  itinerary: ItineraryResponse;
  destination: {
    name: string | null;
    lat: number | null;
    lng: number | null;
  };
}) {
  const [filter, setFilter] = useState<TypeFilter>("all");

  const mappedItems: MappedItem[] = useMemo(() => {
    return itinerary.items
      .map((i) => {
        const opt = i.confirmed_option;
        if (!opt || opt.lat == null || opt.lng == null) return null;
        return { ...i, lat: opt.lat, lng: opt.lng } as MappedItem;
      })
      .filter((x): x is MappedItem => x !== null);
  }, [itinerary.items]);

  const filtered = useMemo(() => {
    return mappedItems.filter((i) => {
      if (filter === "all") return true;
      if (filter === "confirmed") return i.stage === "confirmed";
      if (filter === "pending") return i.stage === "pending";
      return i.item_type === filter;
    });
  }, [mappedItems, filter]);

  const counts = useMemo(() => {
    const c = {
      hotel: 0,
      restaurant: 0,
      activity: 0,
      transport: 0,
      confirmed: 0,
      pending: 0,
    };
    for (const i of mappedItems) {
      if (i.item_type === "hotel") c.hotel++;
      if (i.item_type === "restaurant") c.restaurant++;
      if (i.item_type === "activity") c.activity++;
      if (i.item_type === "transport") c.transport++;
      if (i.stage === "confirmed") c.confirmed++;
      if (i.stage === "pending") c.pending++;
    }
    return c;
  }, [mappedItems]);

  const mapEmbedUrl = useMemo(() => {
    // Compute a bounding box across all visible items + destination
    const points: Array<{ lat: number; lng: number }> = [];
    for (const i of filtered) points.push({ lat: i.lat, lng: i.lng });
    if (destination.lat != null && destination.lng != null) {
      points.push({ lat: destination.lat, lng: destination.lng });
    }

    if (points.length === 0) return null;

    const lats = points.map((p) => p.lat);
    const lngs = points.map((p) => p.lng);
    const padding = 0.01;
    const minLat = Math.min(...lats) - padding;
    const maxLat = Math.max(...lats) + padding;
    const minLng = Math.min(...lngs) - padding;
    const maxLng = Math.max(...lngs) + padding;

    const bbox = `${minLng},${minLat},${maxLng},${maxLat}`;
    // OpenStreetMap embed supports a single marker — use destination if known,
    // else first point. Pin list below the map shows the rest visually.
    const marker =
      destination.lat != null && destination.lng != null
        ? `${destination.lat},${destination.lng}`
        : `${points[0].lat},${points[0].lng}`;
    return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${marker}`;
  }, [filtered, destination]);

  const hasMappable = mappedItems.length > 0 || destination.lat != null;

  return (
    <section className="overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--background)]">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3 sm:px-5">
        <div>
          <h2 className="text-sm font-semibold">Trip map</h2>
          <p className="text-[11px] text-[var(--muted-foreground)]">
            {mappedItems.length} pinned location
            {mappedItems.length === 1 ? "" : "s"}
            {filtered.length !== mappedItems.length && (
              <> · {filtered.length} match filter</>
            )}
          </p>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-1.5 border-b border-[var(--border)] px-4 py-2.5 sm:px-5">
        {FILTERS.map((f) => {
          const active = filter === f.value;
          const count =
            f.value === "all"
              ? mappedItems.length
              : (counts[f.value as keyof typeof counts] ?? 0);
          return (
            <button
              key={f.value}
              type="button"
              onClick={() => setFilter(f.value)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors",
                active
                  ? "bg-[var(--foreground)] text-[var(--background)]"
                  : "border border-[var(--border)] text-[var(--muted-foreground)] hover:bg-[var(--secondary)]"
              )}
            >
              {f.label}
              <span
                className={cn(
                  "rounded-full px-1.5 text-[10px] font-semibold",
                  active
                    ? "bg-[var(--background)]/20"
                    : "bg-[var(--secondary)] text-[var(--muted-foreground)]"
                )}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      <div className="grid gap-0 lg:grid-cols-3" style={{ height: "min(72vh, 720px)" }}>
        <div className="lg:col-span-2 lg:border-r lg:border-[var(--border)]">
          {hasMappable && mapEmbedUrl ? (
            <div className="relative h-72 w-full bg-[var(--secondary)] sm:h-96 lg:h-full">
              <iframe
                title="Trip map"
                src={mapEmbedUrl}
                className="h-full w-full border-0"
                loading="lazy"
              />
              {filtered.length > 0 && (
                <div className="pointer-events-none absolute bottom-2 left-2 right-2 flex flex-wrap gap-1.5">
                  {filtered.slice(0, 6).map((i) => (
                    <span
                      key={i.id}
                      className="pointer-events-auto inline-flex items-center gap-1 rounded-full bg-[var(--background)]/95 px-2 py-1 text-[10px] font-medium shadow-sm backdrop-blur"
                    >
                      <span aria-hidden>
                        {TYPE_ICON[i.item_type] ?? TYPE_ICON.other}
                      </span>
                      <span className="max-w-[8rem] truncate">{i.title}</span>
                    </span>
                  ))}
                  {filtered.length > 6 && (
                    <span className="pointer-events-auto inline-flex items-center rounded-full bg-[var(--background)]/95 px-2 py-1 text-[10px] font-medium text-[var(--muted-foreground)] shadow-sm backdrop-blur">
                      +{filtered.length - 6} more
                    </span>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="flex h-72 flex-col items-center justify-center gap-2 bg-[var(--secondary)]/40 px-6 text-center sm:h-96 lg:h-full">
              <span className="text-3xl" aria-hidden>
                🗺️
              </span>
              <p className="text-sm font-medium">No pinned locations yet</p>
              <p className="max-w-xs text-xs text-[var(--muted-foreground)]">
                As soon as you confirm a hotel, restaurant, or activity, it
                shows up here on the map.
              </p>
            </div>
          )}
        </div>

        <div className="overflow-y-auto lg:col-span-1 lg:h-full">
          {filtered.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs italic text-[var(--muted-foreground)]">
              No locations match this filter.
            </p>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {filtered.map((item) => {
                const distMeters =
                  destination.lat != null && destination.lng != null
                    ? haversineMeters(
                        destination.lat,
                        destination.lng,
                        item.lat,
                        item.lng
                      )
                    : null;
                const opt = item.confirmed_option;
                return (
                  <li key={item.id}>
                    <a
                      href={
                        opt?.google_maps_url ??
                        `https://www.google.com/maps?q=${item.lat},${item.lng}`
                      }
                      target="_blank"
                      rel="noreferrer"
                      className="flex gap-3 px-4 py-3 transition-colors hover:bg-[var(--secondary)]/60"
                    >
                      <span
                        className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--secondary)] text-base"
                        aria-hidden
                      >
                        {TYPE_ICON[item.item_type] ?? TYPE_ICON.other}
                      </span>
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-start justify-between gap-2">
                          <p className="truncate text-sm font-medium">
                            {item.title}
                          </p>
                          <span
                            className={cn(
                              "shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold capitalize",
                              STAGE_TONE[item.stage] ?? STAGE_TONE.todo
                            )}
                          >
                            {item.stage === "pending"
                              ? "vote"
                              : item.stage}
                          </span>
                        </div>
                        {opt?.address && (
                          <p className="truncate text-[11px] text-[var(--muted-foreground)]">
                            {opt.address}
                          </p>
                        )}
                        <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-[var(--muted-foreground)]">
                          <Badge
                            variant="secondary"
                            className="text-[9px] uppercase"
                          >
                            {TYPE_LABEL[item.item_type] ?? "Item"}
                          </Badge>
                          {distMeters != null && (
                            <span>
                              {formatDistance(distMeters)} from{" "}
                              {destination.name ?? "destination"}
                            </span>
                          )}
                          {opt?.rating != null && <span>★ {opt.rating}</span>}
                          {opt?.price_level && <span>{opt.price_level}</span>}
                        </div>
                      </div>
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

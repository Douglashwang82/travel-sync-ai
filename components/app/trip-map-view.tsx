"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { appFetchJson, AppApiFetchError } from "@/lib/app-client";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { TabError, TabSkeleton } from "@/components/app/tab-shell";
import type {
  ItineraryEntry,
  ItineraryResponse,
} from "@/app/api/app/trips/[tripId]/itinerary/route";
import type { WebVotesResponse } from "@/app/api/app/trips/[tripId]/votes/route";
import type { MapPin, DayRoute } from "@/components/app/trip-map-canvas";

// Leaflet uses `window` at import time — load only on the client.
const TripMapCanvas = dynamic(
  () => import("@/components/app/trip-map-canvas"),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center bg-[var(--surface-sunken)]/40">
        <p className="text-xs text-[var(--text-muted)]">Loading map…</p>
      </div>
    ),
  }
);

// ─── Constants ────────────────────────────────────────────────────────────────

const TYPE_LABEL: Record<string, string> = {
  hotel: "Hotels",
  restaurant: "Food",
  activity: "Activities",
  transport: "Transit",
  flight: "Flights",
  insurance: "Insurance",
  other: "Other",
};

const TYPE_GLYPH: Record<string, string> = {
  hotel: "🏨",
  restaurant: "🍽",
  activity: "🎯",
  transport: "🚌",
  flight: "✈",
  insurance: "🛡",
  other: "📌",
};

const STAGE_LABEL: Record<string, string> = {
  confirmed: "Confirmed",
  pending: "Pending vote",
  todo: "To-do",
};

const DAY_PALETTE = [
  "#3b82f6",
  "#10b981",
  "#f97316",
  "#8b5cf6",
  "#ec4899",
  "#0ea5e9",
  "#22c55e",
  "#eab308",
  "#ef4444",
  "#14b8a6",
];

type TypeFilter = "all" | "hotel" | "restaurant" | "activity" | "transport";
type StageFilter = "all" | "confirmed" | "pending";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function dateKey(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toISOString().split("T")[0];
}

function dayLabel(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
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

// ─── Build pins from itinerary + votes ────────────────────────────────────────

function buildPins(
  itinerary: ItineraryResponse,
  votes: WebVotesResponse
): MapPin[] {
  const pins: MapPin[] = [];

  // Confirmed items
  for (const item of itinerary.items) {
    const opt = item.confirmed_option;
    if (!opt || opt.lat == null || opt.lng == null) continue;
    pins.push({
      id: `item:${item.id}`,
      lat: opt.lat,
      lng: opt.lng,
      title: item.title,
      subtitle: opt.address,
      itemType: item.item_type,
      stage: (item.stage as MapPin["stage"]) ?? "todo",
      kind: "item",
      itemId: item.id,
      optionId: opt.id,
      dayKey: dateKey(item.deadline_at),
    });
  }

  // Pending vote options
  const itemById = new Map<string, ItineraryEntry>(
    itinerary.items.map((i) => [i.id, i])
  );
  for (const vote of votes.votes) {
    const dayK =
      itemById.get(vote.item.id)?.deadline_at != null
        ? dateKey(itemById.get(vote.item.id)!.deadline_at)
        : dateKey(vote.item.deadlineAt);
    for (const opt of vote.options) {
      if (opt.lat == null || opt.lng == null) continue;
      pins.push({
        id: `option:${opt.id}`,
        lat: opt.lat,
        lng: opt.lng,
        title: opt.name,
        subtitle: opt.address,
        itemType: vote.item.itemType,
        stage: "pending",
        kind: "option",
        itemId: vote.item.id,
        optionId: opt.id,
        dayKey: dayK,
        votedByMe: opt.votedByMe,
      });
    }
  }

  return pins;
}

// ─── Component ────────────────────────────────────────────────────────────────

interface MapData {
  itinerary: ItineraryResponse;
  votes: WebVotesResponse;
}

export function TripMapView({ tripId }: { tripId: string }) {
  const [data, setData] = useState<MapData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [stageFilter, setStageFilter] = useState<StageFilter>("all");
  const [dayFilter, setDayFilter] = useState<string>("all");
  const [showRoutes, setShowRoutes] = useState(true);
  const [selectedPinId, setSelectedPinId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [itinerary, votes] = await Promise.all([
        appFetchJson<ItineraryResponse>(`/api/app/trips/${tripId}/itinerary`),
        appFetchJson<WebVotesResponse>(`/api/app/trips/${tripId}/votes`),
      ]);
      setError(null);
      setData({ itinerary, votes });
    } catch (err) {
      setError(
        err instanceof AppApiFetchError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Failed to load map data"
      );
    }
  }, [tripId]);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  const allPins = useMemo<MapPin[]>(() => {
    if (!data) return [];
    return buildPins(data.itinerary, data.votes);
  }, [data]);

  const dayKeys = useMemo<string[]>(() => {
    const keys = new Set<string>();
    for (const p of allPins) if (p.dayKey) keys.add(p.dayKey);
    return Array.from(keys).sort();
  }, [allPins]);

  const dayColorByKey = useMemo<Map<string, string>>(() => {
    const m = new Map<string, string>();
    dayKeys.forEach((k, i) => m.set(k, DAY_PALETTE[i % DAY_PALETTE.length]));
    return m;
  }, [dayKeys]);

  const filteredPins = useMemo<MapPin[]>(() => {
    return allPins.filter((p) => {
      if (typeFilter !== "all" && p.itemType !== typeFilter) return false;
      if (stageFilter !== "all" && p.stage !== stageFilter) return false;
      if (dayFilter !== "all") {
        if (dayFilter === "unscheduled") {
          if (p.dayKey != null) return false;
        } else if (p.dayKey !== dayFilter) {
          return false;
        }
      }
      return true;
    });
  }, [allPins, typeFilter, stageFilter, dayFilter]);

  const dayRoutes = useMemo<DayRoute[]>(() => {
    if (!showRoutes || !data) return [];
    const buckets = new Map<string, MapPin[]>();
    for (const pin of filteredPins) {
      // Only confirmed items contribute to the planned route — pending options
      // aren't a chosen sequence yet.
      if (pin.kind !== "item" || pin.stage !== "confirmed") continue;
      if (!pin.dayKey) continue;
      if (!buckets.has(pin.dayKey)) buckets.set(pin.dayKey, []);
      buckets.get(pin.dayKey)!.push(pin);
    }
    const routes: DayRoute[] = [];
    for (const [dayK, pins] of buckets) {
      const item = data.itinerary.items;
      const ordered = pins.slice().sort((a, b) => {
        const ai = item.findIndex((it) => it.id === a.itemId);
        const bi = item.findIndex((it) => it.id === b.itemId);
        return ai - bi;
      });
      routes.push({
        dayKey: dayK,
        label: dayLabel(dayK),
        points: ordered.map((p) => ({ lat: p.lat, lng: p.lng, title: p.title })),
        color: dayColorByKey.get(dayK) ?? "#3b82f6",
      });
    }
    return routes;
  }, [filteredPins, data, showRoutes, dayColorByKey]);

  const pinsByDay = useMemo<
    Array<{ key: string; label: string; color: string; pins: MapPin[] }>
  >(() => {
    const buckets = new Map<string, MapPin[]>();
    for (const pin of filteredPins) {
      const key = pin.dayKey ?? "__unscheduled__";
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key)!.push(pin);
    }
    const out: Array<{
      key: string;
      label: string;
      color: string;
      pins: MapPin[];
    }> = [];
    for (const [key, pins] of buckets) {
      out.push({
        key,
        label:
          key === "__unscheduled__"
            ? "Unscheduled"
            : dayLabel(key),
        color: dayColorByKey.get(key) ?? "#94a3b8",
        pins: pins.slice().sort((a, b) => a.title.localeCompare(b.title)),
      });
    }
    out.sort((a, b) => a.key.localeCompare(b.key));
    return out;
  }, [filteredPins, dayColorByKey]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {
      hotel: 0,
      restaurant: 0,
      activity: 0,
      transport: 0,
      confirmed: 0,
      pending: 0,
    };
    for (const p of allPins) {
      if (p.itemType === "hotel") c.hotel++;
      else if (p.itemType === "restaurant") c.restaurant++;
      else if (p.itemType === "activity") c.activity++;
      else if (p.itemType === "transport") c.transport++;
      if (p.stage === "confirmed") c.confirmed++;
      else if (p.stage === "pending") c.pending++;
    }
    return c;
  }, [allPins]);

  if (error) {
    return <TabError message={error} onRetry={() => void load()} />;
  }

  if (!data) {
    return <TabSkeleton className="h-[calc(100vh-12rem)]" />;
  }

  const destination = {
    name: data.itinerary.trip.destination_name,
    lat: null as number | null,
    lng: null as number | null,
  };
  // Itinerary endpoint doesn't include destination coords; pull them off the
  // first confirmed item if available, otherwise leave null.
  const firstConfirmed = data.itinerary.items.find(
    (i) =>
      i.stage === "confirmed" &&
      i.confirmed_option?.lat != null &&
      i.confirmed_option?.lng != null
  );
  if (firstConfirmed?.confirmed_option) {
    destination.lat = firstConfirmed.confirmed_option.lat;
    destination.lng = firstConfirmed.confirmed_option.lng;
  }

  return (
    <div className="grid gap-3 lg:h-[calc(100vh-13rem)] lg:grid-cols-12">
      {/* Sidebar */}
      <aside className="flex flex-col gap-3 lg:col-span-4 lg:overflow-hidden xl:col-span-3">
        <Filters
          typeFilter={typeFilter}
          setTypeFilter={setTypeFilter}
          stageFilter={stageFilter}
          setStageFilter={setStageFilter}
          dayFilter={dayFilter}
          setDayFilter={setDayFilter}
          dayKeys={dayKeys}
          dayColorByKey={dayColorByKey}
          showRoutes={showRoutes}
          setShowRoutes={setShowRoutes}
          counts={counts}
          totalPins={allPins.length}
          shownPins={filteredPins.length}
        />

        <PinList
          groups={pinsByDay}
          selectedPinId={selectedPinId}
          onSelect={setSelectedPinId}
          destination={destination}
        />
      </aside>

      {/* Map */}
      <div className="surface-tile overflow-hidden lg:col-span-8 xl:col-span-9">
        <div className="h-[60vh] w-full lg:h-full">
          <TripMapCanvas
            destination={destination}
            pins={filteredPins}
            dayRoutes={dayRoutes}
            selectedPinId={selectedPinId}
            onPinSelect={(p) => setSelectedPinId(p.id)}
          />
        </div>
      </div>
    </div>
  );
}

// ─── Filters ──────────────────────────────────────────────────────────────────

function Filters({
  typeFilter,
  setTypeFilter,
  stageFilter,
  setStageFilter,
  dayFilter,
  setDayFilter,
  dayKeys,
  dayColorByKey,
  showRoutes,
  setShowRoutes,
  counts,
  totalPins,
  shownPins,
}: {
  typeFilter: TypeFilter;
  setTypeFilter: (v: TypeFilter) => void;
  stageFilter: StageFilter;
  setStageFilter: (v: StageFilter) => void;
  dayFilter: string;
  setDayFilter: (v: string) => void;
  dayKeys: string[];
  dayColorByKey: Map<string, string>;
  showRoutes: boolean;
  setShowRoutes: (v: boolean) => void;
  counts: Record<string, number>;
  totalPins: number;
  shownPins: number;
}) {
  return (
    <section className="surface-tile p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-caps">Filters</p>
        <p className="text-mono text-[11px] text-[var(--text-muted)]">
          {shownPins} / {totalPins} pins
        </p>
      </div>

      <div className="mt-2">
        <p className="text-caps text-[var(--text-muted)]">
          Type
        </p>
        <div className="mt-1 flex flex-wrap gap-1">
          <Pill
            active={typeFilter === "all"}
            onClick={() => setTypeFilter("all")}
            label="All"
            count={totalPins}
          />
          {(["hotel", "restaurant", "activity", "transport"] as const).map(
            (t) => (
              <Pill
                key={t}
                active={typeFilter === t}
                onClick={() => setTypeFilter(t)}
                label={`${TYPE_GLYPH[t]} ${TYPE_LABEL[t]}`}
                count={counts[t] ?? 0}
              />
            )
          )}
        </div>
      </div>

      <div className="mt-2">
        <p className="text-caps text-[var(--text-muted)]">
          Stage
        </p>
        <div className="mt-1 flex flex-wrap gap-1">
          <Pill
            active={stageFilter === "all"}
            onClick={() => setStageFilter("all")}
            label="All"
          />
          <Pill
            active={stageFilter === "confirmed"}
            onClick={() => setStageFilter("confirmed")}
            label="✓ Confirmed"
            count={counts.confirmed}
          />
          <Pill
            active={stageFilter === "pending"}
            onClick={() => setStageFilter("pending")}
            label="🗳 Pending vote"
            count={counts.pending}
          />
        </div>
      </div>

      {dayKeys.length > 0 && (
        <div className="mt-2">
          <p className="text-caps text-[var(--text-muted)]">
            Day
          </p>
          <div className="mt-1 flex flex-wrap gap-1">
            <Pill
              active={dayFilter === "all"}
              onClick={() => setDayFilter("all")}
              label="All days"
            />
            {dayKeys.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setDayFilter(k)}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors",
                  dayFilter === k
                    ? "border-[var(--text-primary)] bg-[var(--text-primary)] text-[var(--surface-raised)]"
                    : "border-[var(--border-hairline)] text-[var(--text-muted)] hover:bg-[var(--surface-sunken)]"
                )}
              >
                <span
                  aria-hidden
                  className="h-2 w-2 rounded-full"
                  style={{ background: dayColorByKey.get(k) }}
                />
                {dayLabel(k)}
              </button>
            ))}
            <Pill
              active={dayFilter === "unscheduled"}
              onClick={() => setDayFilter("unscheduled")}
              label="Unscheduled"
            />
          </div>
        </div>
      )}

      <label className="mt-3 flex items-center gap-2 text-xs text-[var(--text-muted)]">
        <input
          type="checkbox"
          checked={showRoutes}
          onChange={(e) => setShowRoutes(e.target.checked)}
          className="h-3.5 w-3.5 rounded border-[var(--border-hairline)]"
        />
        Show daily routes
      </label>
    </section>
  );
}

function Pill({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors",
        active
          ? "border-[var(--text-primary)] bg-[var(--text-primary)] text-[var(--surface-raised)]"
          : "border-[var(--border-hairline)] text-[var(--text-muted)] hover:bg-[var(--surface-sunken)]"
      )}
    >
      {label}
      {count !== undefined && (
        <span
          className={cn(
            "rounded-full px-1.5 text-[10px] font-semibold",
            active
              ? "bg-[var(--surface-raised)]/20"
              : "bg-[var(--surface-sunken)] text-[var(--text-muted)]"
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}

// ─── Pin list (sidebar) ───────────────────────────────────────────────────────

function PinList({
  groups,
  selectedPinId,
  onSelect,
  destination,
}: {
  groups: Array<{ key: string; label: string; color: string; pins: MapPin[] }>;
  selectedPinId: string | null;
  onSelect: (pinId: string) => void;
  destination: { lat: number | null; lng: number | null };
}) {
  if (groups.length === 0) {
    return (
      <section className="surface-tile flex-1 border-dashed p-6 text-center text-xs text-[var(--text-muted)]">
        No locations match these filters.
      </section>
    );
  }

  return (
    <section className="surface-tile flex-1 overflow-y-auto">
      {groups.map((group) => (
        <div key={group.key}>
          <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-[var(--border-hairline)] bg-[var(--surface-glass)] px-3 py-1.5 backdrop-blur">
            <div className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="h-2 w-2 rounded-full"
                style={{ background: group.color }}
              />
              <p className="text-caps">
                {group.label}
              </p>
            </div>
            <span className="text-[10px] text-[var(--text-muted)]">
              {group.pins.length}
            </span>
          </div>
          <ul className="divide-y divide-[var(--border-hairline)]">
            {group.pins.map((pin, i) => {
              const distance =
                destination.lat != null && destination.lng != null
                  ? haversineMeters(
                      destination.lat,
                      destination.lng,
                      pin.lat,
                      pin.lng
                    )
                  : null;
              const prev =
                i > 0 && group.pins[i - 1].kind === "item" && pin.kind === "item"
                  ? group.pins[i - 1]
                  : null;
              const fromPrev = prev
                ? haversineMeters(prev.lat, prev.lng, pin.lat, pin.lng)
                : null;
              return (
                <li key={pin.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(pin.id)}
                    className={cn(
                      "flex w-full gap-2 px-3 py-2 text-left transition-colors hover:bg-[var(--surface-sunken)]/60",
                      selectedPinId === pin.id && "bg-[var(--accent-line-soft)]"
                    )}
                  >
                    <span
                      aria-hidden
                      className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-sunken)] text-base"
                    >
                      {TYPE_GLYPH[pin.itemType] ?? "📌"}
                    </span>
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="flex items-start justify-between gap-2">
                        <p className="truncate text-sm font-medium">
                          {pin.title}
                        </p>
                        <Badge
                          variant="secondary"
                          className="shrink-0 text-[9px] uppercase"
                        >
                          {STAGE_LABEL[pin.stage] ?? pin.stage}
                        </Badge>
                      </div>
                      {pin.subtitle && (
                        <p className="truncate text-[11px] text-[var(--text-muted)]">
                          📍 {pin.subtitle}
                        </p>
                      )}
                      <p className="text-[10px] text-[var(--text-muted)]">
                        {distance != null && (
                          <>{formatDistance(distance)} from center</>
                        )}
                        {fromPrev != null && (
                          <>
                            {distance != null && " · "}
                            {formatDistance(fromPrev)} from prev
                          </>
                        )}
                        {pin.kind === "option" && (
                          <>
                            {(distance != null || fromPrev != null) && " · "}
                            vote option
                            {pin.votedByMe && " · ✓ your pick"}
                          </>
                        )}
                      </p>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </section>
  );
}

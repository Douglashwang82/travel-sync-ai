"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { appFetchJson, AppApiFetchError } from "@/lib/app-client";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { TabError, TabSkeleton } from "@/components/app/tab-shell";
import type { MapPin, DayRoute } from "@/components/app/trip-map-canvas";
import type {
  GlobalMapPlace,
  GlobalMapResponse,
  GlobalMapTripSummary,
} from "@/app/api/app/places/global-map/route";

// Google Maps JS depends on `window` — load only on the client.
const TripMapCanvas = dynamic(
  () => import("@/components/app/trip-map-canvas"),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center bg-[var(--surface-sunken)]/40">
        <p className="text-xs text-[var(--text-muted)]">地圖載入中...</p>
      </div>
    ),
  }
);

const TYPE_LABEL: Record<string, string> = {
  hotel: "住宿",
  restaurant: "餐飲",
  activity: "活動",
  transport: "交通",
  flight: "航班",
  insurance: "保險",
  other: "其他",
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
  confirmed: "已確認",
  pending: "投票中",
  todo: "待辦",
  shared: "分享記錄",
};

// Distinct color per trip so users can read the map at a glance.
const TRIP_PALETTE = [
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
  "#6366f1",
  "#84cc16",
];

type TripFilter = "all" | string;
type TypeFilter = "all" | "hotel" | "restaurant" | "activity" | "transport";
type StageFilter = "all" | "confirmed" | "pending" | "shared";
type Basemap = "roadmap" | "satellite" | "hybrid";

export function GlobalMapView() {
  const [data, setData] = useState<GlobalMapResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tripFilter, setTripFilter] = useState<TripFilter>("all");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [stageFilter, setStageFilter] = useState<StageFilter>("all");
  const [basemap, setBasemap] = useState<Basemap>("roadmap");
  const [query, setQuery] = useState("");
  const [selectedPinId, setSelectedPinId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await appFetchJson<GlobalMapResponse>(
        "/api/app/places/global-map"
      );
      setError(null);
      setData(res);
    } catch (err) {
      setError(
        err instanceof AppApiFetchError
          ? err.message
          : err instanceof Error
            ? err.message
            : "地圖資料載入失敗"
      );
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  const tripColorById = useMemo<Map<string, string>>(() => {
    const m = new Map<string, string>();
    (data?.trips ?? []).forEach((t, i) => {
      m.set(t.id, TRIP_PALETTE[i % TRIP_PALETTE.length]);
    });
    return m;
  }, [data]);

  const filteredPlaces = useMemo<GlobalMapPlace[]>(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    return data.places.filter((p) => {
      if (tripFilter !== "all" && p.tripId !== tripFilter) return false;
      if (typeFilter !== "all" && p.itemType !== typeFilter) return false;
      if (stageFilter !== "all" && p.stage !== stageFilter) return false;
      if (q) {
        const hay = `${p.title} ${p.subtitle ?? ""} ${p.tripName ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [data, tripFilter, typeFilter, stageFilter, query]);

  const pins = useMemo<MapPin[]>(() => {
    return filteredPlaces.map((p) => ({
      id: p.id,
      lat: p.lat,
      lng: p.lng,
      title: p.title,
      subtitle: p.tripName ? `${p.tripName} · ${p.subtitle ?? ""}`.trim() : p.subtitle,
      itemType: p.itemType,
      stage: p.stage,
      kind: p.kind,
      itemId: null,
      optionId: null,
      dayKey: p.dayKey,
      bookingUrl: p.bookingUrl,
    }));
  }, [filteredPlaces]);

  // One per-trip dashed "scope" outline using the trip color helps
  // distinguish overlapping trips on the same city. We render polylines
  // between confirmed items of each trip in itinerary order via dayKey
  // grouping; the canvas treats DayRoute the same way it does for the
  // per-trip view.
  const dayRoutes = useMemo<DayRoute[]>(() => {
    if (!data) return [];
    const buckets = new Map<string, MapPin[]>();
    for (const place of filteredPlaces) {
      if (place.kind !== "item" || place.stage !== "confirmed") continue;
      if (!place.dayKey) continue;
      const key = `${place.tripId}|${place.dayKey}`;
      const pin: MapPin = {
        id: place.id,
        lat: place.lat,
        lng: place.lng,
        title: place.title,
        subtitle: place.subtitle,
        itemType: place.itemType,
        stage: place.stage,
        kind: place.kind,
        itemId: null,
        optionId: null,
        dayKey: place.dayKey,
        bookingUrl: place.bookingUrl,
      };
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key)!.push(pin);
    }
    const routes: DayRoute[] = [];
    for (const [key, daysPins] of buckets) {
      const [tripId, dayKey] = key.split("|");
      const ordered = daysPins.slice();
      routes.push({
        dayKey: key,
        label: dayKey,
        points: ordered.map((p) => ({ lat: p.lat, lng: p.lng, title: p.title })),
        color: tripColorById.get(tripId) ?? "#3b82f6",
      });
    }
    return routes;
  }, [data, filteredPlaces, tripColorById]);

  // Center the map roughly on the user's data when there's no destination
  // to fall back to. We pass the first place as a faux "destination" so the
  // canvas auto-fit logic still works across all pins.
  const fauxDestination = useMemo(() => {
    if (!data) return { name: null, lat: null, lng: null };
    const firstTrip = data.trips.find(
      (t) => t.destinationLat != null && t.destinationLng != null
    );
    if (firstTrip) {
      return {
        name: firstTrip.name,
        lat: firstTrip.destinationLat,
        lng: firstTrip.destinationLng,
      };
    }
    const firstPin = pins[0];
    if (firstPin) {
      return { name: null, lat: firstPin.lat, lng: firstPin.lng };
    }
    return { name: null, lat: null, lng: null };
  }, [data, pins]);

  const selectedPlace = useMemo(
    () => filteredPlaces.find((p) => p.id === selectedPinId) ?? null,
    [filteredPlaces, selectedPinId]
  );

  if (error && !data) {
    return <TabError message={error} onRetry={() => void load()} />;
  }
  if (!data) {
    return <TabSkeleton className="h-[calc(100vh-12rem)]" />;
  }

  const counts = countsFor(data.places);

  return (
    <div className="-mx-4 -mt-2 flex h-[calc(100vh-7rem)] flex-col gap-2 px-4">
      <Header
        totalPlaces={data.places.length}
        shownPlaces={filteredPlaces.length}
        totalTrips={data.trips.length}
        basemap={basemap}
        setBasemap={setBasemap}
        query={query}
        setQuery={setQuery}
      />

      <div className="grid min-h-0 flex-1 gap-2 lg:grid-cols-12">
        <aside className="flex min-h-0 flex-col gap-2 lg:col-span-3">
          <TripLegend
            trips={data.trips}
            tripColorById={tripColorById}
            tripFilter={tripFilter}
            setTripFilter={setTripFilter}
          />
          <FilterTile
            typeFilter={typeFilter}
            setTypeFilter={setTypeFilter}
            stageFilter={stageFilter}
            setStageFilter={setStageFilter}
            counts={counts}
          />
          <PlaceList
            places={filteredPlaces}
            selectedPinId={selectedPinId}
            onSelect={setSelectedPinId}
            tripColorById={tripColorById}
          />
        </aside>

        <div className="surface-tile relative min-h-[420px] overflow-hidden lg:col-span-9">
          <TripMapCanvas
            destination={fauxDestination}
            pins={pins}
            dayRoutes={dayRoutes}
            selectedPinId={selectedPinId}
            onPinSelect={(p) => setSelectedPinId(p.id)}
            mapTypeId={basemap}
          />
          {selectedPlace && (
            <DetailFloater
              place={selectedPlace}
              tripColor={tripColorById.get(selectedPlace.tripId) ?? "#3b82f6"}
              onClose={() => setSelectedPinId(null)}
            />
          )}
          {pins.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center bg-[var(--surface-sunken)]/30">
              <p className="rounded-lg bg-[var(--surface-raised)] px-4 py-2 text-xs text-[var(--text-muted)] shadow-[var(--shadow-flat)]">
                沒有符合條件的地點。
              </p>
            </div>
          )}
        </div>
      </div>

      {error && data && (
        <div className="surface-tile shrink-0 border border-red-500/40 p-2 text-xs text-red-500">
          {error}
        </div>
      )}
    </div>
  );
}

// ─── Header ──────────────────────────────────────────────────────────────────

function Header({
  totalPlaces,
  shownPlaces,
  totalTrips,
  basemap,
  setBasemap,
  query,
  setQuery,
}: {
  totalPlaces: number;
  shownPlaces: number;
  totalTrips: number;
  basemap: Basemap;
  setBasemap: (v: Basemap) => void;
  query: string;
  setQuery: (v: string) => void;
}) {
  return (
    <header className="surface-tile flex shrink-0 flex-wrap items-center gap-2 p-2">
      <span className="text-sm font-semibold">🗺 主地圖</span>
      <span aria-hidden className="text-[var(--text-faint)]">·</span>
      <span className="text-mono text-[11px] text-[var(--text-muted)]">
        {totalTrips} 趟旅程 · {shownPlaces} / {totalPlaces} 個地點
      </span>

      <div className="ml-auto flex flex-wrap items-center gap-1.5">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜尋地點或旅程…"
          className="h-8 w-56 text-xs"
        />
        <span aria-hidden className="text-[var(--text-faint)]">|</span>
        {(["roadmap", "satellite", "hybrid"] as const).map((b) => (
          <Chip
            key={b}
            active={basemap === b}
            onClick={() => setBasemap(b)}
            label={
              b === "roadmap" ? "地圖" : b === "satellite" ? "衛星" : "混合"
            }
          />
        ))}
      </div>
    </header>
  );
}

// ─── Trip legend ─────────────────────────────────────────────────────────────

function TripLegend({
  trips,
  tripColorById,
  tripFilter,
  setTripFilter,
}: {
  trips: GlobalMapTripSummary[];
  tripColorById: Map<string, string>;
  tripFilter: TripFilter;
  setTripFilter: (v: TripFilter) => void;
}) {
  if (trips.length === 0) {
    return (
      <section className="surface-tile p-3 text-center text-xs text-[var(--text-muted)]">
        尚無旅程。
      </section>
    );
  }
  return (
    <section className="surface-tile shrink-0 p-2.5">
      <div className="flex items-center justify-between">
        <p className="text-caps">旅程</p>
        <p className="text-mono text-[10px] text-[var(--text-muted)]">
          {trips.length}
        </p>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1">
        <Chip
          active={tripFilter === "all"}
          onClick={() => setTripFilter("all")}
          label="全部"
        />
        {trips.map((t) => {
          const active = tripFilter === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTripFilter(active ? "all" : t.id)}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors",
                active
                  ? "border-[var(--text-primary)] bg-[var(--text-primary)] text-[var(--surface-raised)]"
                  : "border-[var(--border-hairline)] text-[var(--text-muted)] hover:bg-[var(--surface-sunken)]"
              )}
              title={t.name ?? "Untitled trip"}
            >
              <span
                aria-hidden
                className="h-2 w-2 rounded-full"
                style={{ background: tripColorById.get(t.id) }}
              />
              <span className="max-w-[7rem] truncate">
                {t.name ?? "未命名旅程"}
              </span>
              <span
                className={cn(
                  "rounded-full px-1 text-[9px]",
                  active
                    ? "bg-[var(--surface-raised)]/20"
                    : "bg-[var(--surface-sunken)]"
                )}
              >
                {t.placeCount}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

// ─── Filter tile ─────────────────────────────────────────────────────────────

function FilterTile({
  typeFilter,
  setTypeFilter,
  stageFilter,
  setStageFilter,
  counts,
}: {
  typeFilter: TypeFilter;
  setTypeFilter: (v: TypeFilter) => void;
  stageFilter: StageFilter;
  setStageFilter: (v: StageFilter) => void;
  counts: Record<string, number>;
}) {
  return (
    <section className="surface-tile shrink-0 p-2.5">
      <p className="text-caps">篩選</p>
      <div className="mt-1.5 flex flex-wrap gap-1">
        <Chip
          active={typeFilter === "all"}
          onClick={() => setTypeFilter("all")}
          label="全部"
        />
        {(["hotel", "restaurant", "activity", "transport"] as const).map((t) => (
          <Chip
            key={t}
            active={typeFilter === t}
            onClick={() => setTypeFilter(t)}
            label={`${TYPE_GLYPH[t]} ${TYPE_LABEL[t]}`}
            count={counts[t] ?? 0}
          />
        ))}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1">
        <Chip
          active={stageFilter === "all"}
          onClick={() => setStageFilter("all")}
          label="全部狀態"
        />
        <Chip
          active={stageFilter === "confirmed"}
          onClick={() => setStageFilter("confirmed")}
          label="已確認"
          count={counts.confirmed}
        />
        <Chip
          active={stageFilter === "pending"}
          onClick={() => setStageFilter("pending")}
          label="投票中"
          count={counts.pending}
        />
        <Chip
          active={stageFilter === "shared"}
          onClick={() => setStageFilter("shared")}
          label="分享記錄"
          count={counts.shared}
        />
      </div>
    </section>
  );
}

// ─── Place list ──────────────────────────────────────────────────────────────

function PlaceList({
  places,
  selectedPinId,
  onSelect,
  tripColorById,
}: {
  places: GlobalMapPlace[];
  selectedPinId: string | null;
  onSelect: (id: string) => void;
  tripColorById: Map<string, string>;
}) {
  if (places.length === 0) {
    return (
      <section className="surface-tile flex-1 border-dashed p-6 text-center text-xs text-[var(--text-muted)]">
        沒有符合條件的地點。
      </section>
    );
  }
  return (
    <section className="surface-tile flex-1 overflow-y-auto">
      <ul className="divide-y divide-[var(--border-hairline)]">
        {places.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => onSelect(p.id)}
              className={cn(
                "flex w-full items-start gap-2 px-3 py-2 text-left transition-colors hover:bg-[var(--surface-sunken)]/60",
                selectedPinId === p.id && "bg-[var(--accent-line-soft)]"
              )}
            >
              <span
                aria-hidden
                className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-sunken)] text-base"
                style={{
                  boxShadow: `inset 0 0 0 2px ${tripColorById.get(p.tripId) ?? "#94a3b8"}`,
                }}
              >
                {TYPE_GLYPH[p.itemType] ?? "📌"}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <p className="truncate text-sm font-medium">{p.title}</p>
                  <Badge
                    variant="secondary"
                    className="shrink-0 text-[9px] uppercase"
                  >
                    {STAGE_LABEL[p.stage] ?? p.stage}
                  </Badge>
                </div>
                {p.tripName && (
                  <p className="truncate text-[11px] text-[var(--text-muted)]">
                    ✈ {p.tripName}
                  </p>
                )}
                {p.subtitle && (
                  <p className="truncate text-[10px] text-[var(--text-muted)]">
                    📍 {p.subtitle}
                  </p>
                )}
              </div>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ─── Detail floater (over the map) ───────────────────────────────────────────

function DetailFloater({
  place,
  tripColor,
  onClose,
}: {
  place: GlobalMapPlace;
  tripColor: string;
  onClose: () => void;
}) {
  const gMapsUrl =
    place.googleMapsUrl ??
    `https://www.google.com/maps/search/?api=1&query=${place.lat},${place.lng}`;
  return (
    <div className="surface-glass absolute right-3 top-3 w-72 rounded-lg p-3 shadow-[var(--shadow-flat)]">
      <div className="flex items-start gap-2">
        <span
          className="flex h-9 w-9 items-center justify-center rounded-lg text-xl"
          style={{
            background: "var(--surface-sunken)",
            boxShadow: `inset 0 0 0 2px ${tripColor}`,
          }}
        >
          {TYPE_GLYPH[place.itemType] ?? "📌"}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{place.title}</p>
          <p className="mt-0.5 text-[10px] uppercase text-[var(--text-muted)]">
            {TYPE_LABEL[place.itemType] ?? place.itemType} ·{" "}
            {STAGE_LABEL[place.stage] ?? place.stage}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          aria-label="關閉"
        >
          ✕
        </button>
      </div>
      {place.tripName && (
        <Link
          href={`/app/trips/${place.tripId}`}
          className="mt-2 block truncate text-xs text-[var(--accent-line)] hover:underline"
        >
          ✈ {place.tripName} →
        </Link>
      )}
      {place.subtitle && (
        <p className="mt-1 text-[11px] text-[var(--text-muted)]">
          📍 {place.subtitle}
        </p>
      )}
      <div className="text-mono mt-2 text-[10px] text-[var(--text-muted)]">
        {place.lat.toFixed(5)}, {place.lng.toFixed(5)}
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        <a
          href={gMapsUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 rounded-md border border-[var(--border-hairline)] px-2 py-1 text-[11px] hover:bg-[var(--surface-sunken)]/60"
        >
          Google Maps ↗
        </a>
        <Link
          href={`/app/trips/${place.tripId}/map`}
          className="inline-flex items-center gap-1 rounded-md border border-[var(--border-hairline)] px-2 py-1 text-[11px] hover:bg-[var(--surface-sunken)]/60"
        >
          開啟旅程地圖 ↗
        </Link>
        {place.bookingUrl && (
          <a
            href={place.bookingUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-md bg-[var(--text-primary)] px-2 py-1 text-[11px] text-[var(--surface-raised)] hover:opacity-90"
          >
            訂位 ↗
          </a>
        )}
      </div>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function countsFor(places: GlobalMapPlace[]): Record<string, number> {
  const c: Record<string, number> = {
    hotel: 0,
    restaurant: 0,
    activity: 0,
    transport: 0,
    confirmed: 0,
    pending: 0,
    shared: 0,
  };
  for (const p of places) {
    if (p.itemType === "hotel") c.hotel++;
    else if (p.itemType === "restaurant") c.restaurant++;
    else if (p.itemType === "activity") c.activity++;
    else if (p.itemType === "transport") c.transport++;
    if (p.stage === "confirmed") c.confirmed++;
    else if (p.stage === "pending") c.pending++;
    else if (p.stage === "shared") c.shared++;
  }
  return c;
}

function Chip({
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

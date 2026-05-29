"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { appFetchJson, AppApiFetchError } from "@/lib/app-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { TabError, TabSkeleton } from "@/components/app/tab-shell";
import type { MapPin, DayRoute } from "@/components/app/trip-map-canvas";
import type {
  GlobalMapPlace,
  GlobalMapResponse,
  GlobalMapTripSummary,
} from "@/app/api/app/places/global-map/route";
import type {
  ExplorePoi,
  ExplorePoisResponse,
} from "@/app/api/app/explore/pois/route";
import type {
  ExploreRoute,
  ExploreRoutesResponse,
} from "@/app/api/app/explore/routes/route";
import type {
  NearbyPlace,
  NearbyResponse,
} from "@/app/api/app/places/nearby/route";

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
  explore: "探索",
};

const PACE_LABEL: Record<string, string> = {
  chill: "悠閒",
  balanced: "均衡",
  packed: "緊湊",
};

const ROUTE_COLOR = "#2563eb";

// Distinct color per trip so users can read the "my places" layer at a glance.
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

type Layer = "mine" | "explore" | "routes";
type TripFilter = "all" | string;
type TypeFilter = "all" | "hotel" | "restaurant" | "activity" | "transport";
type StageFilter = "all" | "confirmed" | "pending" | "shared";
type Basemap = "roadmap" | "satellite" | "hybrid";

interface Destination {
  name: string;
  lat: number | null;
  lng: number | null;
}

export function GlobalMapView() {
  const [data, setData] = useState<GlobalMapResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [layer, setLayer] = useState<Layer>("mine");
  const [destination, setDestination] = useState<string | null>(null);
  const [basemap, setBasemap] = useState<Basemap>("roadmap");
  const [selectedPinId, setSelectedPinId] = useState<string | null>(null);

  // ── "My places" layer state ───────────────────────────────────────────────
  const [tripFilter, setTripFilter] = useState<TripFilter>("all");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [stageFilter, setStageFilter] = useState<StageFilter>("all");
  const [mineQuery, setMineQuery] = useState("");

  // ── "Explore" layer state ─────────────────────────────────────────────────
  const [exploreQuery, setExploreQuery] = useState("");
  const [exploreType, setExploreType] = useState<TypeFilter>("all");
  const [curatedPois, setCuratedPois] = useState<ExplorePoi[]>([]);
  const [googlePlaces, setGooglePlaces] = useState<NearbyPlace[]>([]);
  const [exploreLoading, setExploreLoading] = useState(false);

  // ── "Routes" layer state ──────────────────────────────────────────────────
  const [routes, setRoutes] = useState<ExploreRoute[]>([]);
  const [routesLoading, setRoutesLoading] = useState(false);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);

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

  // Destinations are derived from the user's trips — they double as the corpus
  // keys for curated POI / route lookups.
  const destinations = useMemo<Destination[]>(() => {
    if (!data) return [];
    const m = new Map<string, Destination>();
    for (const t of data.trips) {
      if (!t.name) continue;
      const existing = m.get(t.name);
      if (!existing) {
        m.set(t.name, {
          name: t.name,
          lat: t.destinationLat,
          lng: t.destinationLng,
        });
      } else if (existing.lat == null && t.destinationLat != null) {
        existing.lat = t.destinationLat;
        existing.lng = t.destinationLng;
      }
    }
    return Array.from(m.values());
  }, [data]);

  const destObj = useMemo(
    () => destinations.find((d) => d.name === destination) ?? null,
    [destinations, destination]
  );

  useEffect(() => {
    if (!destination && destinations.length > 0) {
      setDestination(destinations[0].name);
    }
  }, [destinations, destination]);

  // Clear any cross-layer pin selection when switching layers.
  useEffect(() => {
    setSelectedPinId(null);
  }, [layer]);

  // ── Curated POI loader (explore layer) ────────────────────────────────────
  const loadCuratedPois = useCallback(
    async (q: string) => {
      if (!destination) return;
      setExploreLoading(true);
      try {
        const params = new URLSearchParams({ destination });
        if (q.trim()) params.set("q", q.trim());
        if (exploreType !== "all") params.set("types", exploreType);
        const res = await appFetchJson<ExplorePoisResponse>(
          `/api/app/explore/pois?${params.toString()}`
        );
        setCuratedPois(res.pois);
      } catch {
        setCuratedPois([]);
      } finally {
        setExploreLoading(false);
      }
    },
    [destination, exploreType]
  );

  // Live Google Places search around the destination (explore layer).
  const runGoogleSearch = useCallback(async () => {
    if (!destObj || destObj.lat == null || destObj.lng == null) return;
    try {
      const res = await appFetchJson<NearbyResponse>("/api/app/places/nearby", {
        method: "POST",
        body: JSON.stringify({
          q: exploreQuery.trim() || undefined,
          lat: destObj.lat,
          lng: destObj.lng,
          radius: 8000,
          category: exploreType === "all" ? "any" : exploreType,
          limit: 16,
        }),
      });
      setGooglePlaces(res.places);
    } catch {
      setGooglePlaces([]);
    }
  }, [destObj, exploreQuery, exploreType]);

  const runExploreSearch = useCallback(() => {
    void loadCuratedPois(exploreQuery);
    void runGoogleSearch();
  }, [loadCuratedPois, runGoogleSearch, exploreQuery]);

  // Refresh curated POIs when the explore layer opens or its destination/type
  // changes. Google results stay sticky until the user explicitly searches, to
  // conserve Places quota.
  useEffect(() => {
    if (layer !== "explore" || !destination) return;
    setGooglePlaces([]);
    void loadCuratedPois(exploreQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layer, destination, exploreType]);

  // Load curated routes when the routes layer opens or destination changes.
  useEffect(() => {
    if (layer !== "routes" || !destination) return;
    setRoutesLoading(true);
    setSelectedRouteId(null);
    void (async () => {
      try {
        const res = await appFetchJson<ExploreRoutesResponse>(
          `/api/app/explore/routes?destination=${encodeURIComponent(destination)}`
        );
        setRoutes(res.routes);
        if (res.routes.length > 0) setSelectedRouteId(res.routes[0].routeId);
      } catch {
        setRoutes([]);
      } finally {
        setRoutesLoading(false);
      }
    })();
  }, [layer, destination]);

  const tripColorById = useMemo<Map<string, string>>(() => {
    const m = new Map<string, string>();
    (data?.trips ?? []).forEach((t, i) => {
      m.set(t.id, TRIP_PALETTE[i % TRIP_PALETTE.length]);
    });
    return m;
  }, [data]);

  // ── "My places" derived data ──────────────────────────────────────────────
  const filteredPlaces = useMemo<GlobalMapPlace[]>(() => {
    if (!data) return [];
    const q = mineQuery.trim().toLowerCase();
    return data.places.filter((p) => {
      if (tripFilter !== "all" && p.tripId !== tripFilter) return false;
      if (typeFilter !== "all" && p.itemType !== typeFilter) return false;
      if (stageFilter !== "all" && p.stage !== stageFilter) return false;
      if (q) {
        const hay =
          `${p.title} ${p.subtitle ?? ""} ${p.tripName ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [data, tripFilter, typeFilter, stageFilter, mineQuery]);

  const minePins = useMemo<MapPin[]>(() => {
    return filteredPlaces.map((p) => ({
      id: p.id,
      lat: p.lat,
      lng: p.lng,
      title: p.title,
      subtitle: p.tripName
        ? `${p.tripName} · ${p.subtitle ?? ""}`.trim()
        : p.subtitle,
      itemType: p.itemType,
      stage: p.stage,
      kind: p.kind,
      itemId: null,
      optionId: null,
      dayKey: p.dayKey,
      bookingUrl: p.bookingUrl,
    }));
  }, [filteredPlaces]);

  const mineDayRoutes = useMemo<DayRoute[]>(() => {
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
    const out: DayRoute[] = [];
    for (const [key, daysPins] of buckets) {
      const [tripId, dayKey] = key.split("|");
      out.push({
        dayKey: key,
        label: dayKey,
        points: daysPins.map((p) => ({ lat: p.lat, lng: p.lng, title: p.title })),
        color: tripColorById.get(tripId) ?? "#3b82f6",
      });
    }
    return out;
  }, [data, filteredPlaces, tripColorById]);

  const mineDestination = useMemo<{
    name: string | null;
    lat: number | null;
    lng: number | null;
  }>(() => {
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
    const firstPin = minePins[0];
    if (firstPin) return { name: null, lat: firstPin.lat, lng: firstPin.lng };
    return { name: null, lat: null, lng: null };
  }, [data, minePins]);

  // ── "Explore" derived data ────────────────────────────────────────────────
  const explorePins = useMemo<MapPin[]>(() => {
    const out: MapPin[] = [];
    const seen = new Set<string>();
    for (const p of curatedPois) {
      if (exploreType !== "all" && p.itemType !== exploreType) continue;
      const key = `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;
      seen.add(key);
      out.push({
        id: `poi:${p.placeId}`,
        lat: p.lat,
        lng: p.lng,
        title: p.name,
        subtitle: p.description || null,
        itemType: p.itemType,
        stage: "explore",
        kind: "poi",
        itemId: null,
        optionId: null,
        dayKey: null,
        bookingUrl: p.googleMapsUrl,
      });
    }
    for (const g of googlePlaces) {
      const t = inferItemTypeFromGoogleType(g.primaryType);
      if (exploreType !== "all" && t !== exploreType) continue;
      const key = `${g.lat.toFixed(5)},${g.lng.toFixed(5)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        id: `gplace:${g.placeId}`,
        lat: g.lat,
        lng: g.lng,
        title: g.name,
        subtitle: g.address,
        itemType: t,
        stage: "explore",
        kind: "poi",
        itemId: null,
        optionId: null,
        dayKey: null,
        bookingUrl: g.googleMapsUri,
      });
    }
    return out;
  }, [curatedPois, googlePlaces, exploreType]);

  // ── "Routes" derived data ─────────────────────────────────────────────────
  const selectedRoute = useMemo(
    () => routes.find((r) => r.routeId === selectedRouteId) ?? null,
    [routes, selectedRouteId]
  );

  const routePins = useMemo<MapPin[]>(() => {
    if (!selectedRoute) return [];
    return selectedRoute.places.map((pl, i) => ({
      id: `rp:${selectedRoute.routeId}:${pl.placeId}:${i}`,
      lat: pl.lat,
      lng: pl.lng,
      title: `${i + 1}. ${pl.name}`,
      subtitle: null,
      itemType: pl.itemType,
      stage: "explore",
      kind: "poi",
      itemId: null,
      optionId: null,
      dayKey: null,
    }));
  }, [selectedRoute]);

  const routeDayRoutes = useMemo<DayRoute[]>(() => {
    if (!selectedRoute || selectedRoute.places.length < 2) return [];
    return [
      {
        dayKey: selectedRoute.routeId,
        label: selectedRoute.title,
        points: selectedRoute.places.map((p) => ({
          lat: p.lat,
          lng: p.lng,
          title: p.name,
        })),
        color: ROUTE_COLOR,
      },
    ];
  }, [selectedRoute]);

  // ── Active canvas inputs (per layer) ──────────────────────────────────────
  const activePins =
    layer === "mine" ? minePins : layer === "explore" ? explorePins : routePins;
  const activeRoutes =
    layer === "mine" ? mineDayRoutes : layer === "routes" ? routeDayRoutes : [];
  const activeDestination =
    layer === "mine"
      ? mineDestination
      : { name: destObj?.name ?? null, lat: destObj?.lat ?? null, lng: destObj?.lng ?? null };

  const selectedMinePlace = useMemo(
    () =>
      layer === "mine"
        ? (filteredPlaces.find((p) => p.id === selectedPinId) ?? null)
        : null,
    [layer, filteredPlaces, selectedPinId]
  );
  const selectedPin = useMemo(
    () => activePins.find((p) => p.id === selectedPinId) ?? null,
    [activePins, selectedPinId]
  );

  if (error && !data) {
    return <TabError message={error} onRetry={() => void load()} />;
  }
  if (!data) {
    return <TabSkeleton className="h-[calc(100vh-12rem)]" />;
  }

  const counts = countsFor(data.places);

  return (
    <div className="flex h-full flex-col gap-2 p-2">
      <Header
        layer={layer}
        setLayer={setLayer}
        destinations={destinations}
        destination={destination}
        setDestination={setDestination}
        basemap={basemap}
        setBasemap={setBasemap}
        totalTrips={data.trips.length}
        shownCount={activePins.length}
      />

      <div className="grid min-h-0 flex-1 gap-2 lg:grid-cols-12">
        <aside className="flex min-h-0 flex-col gap-2 lg:col-span-3">
          {layer === "mine" && (
            <>
              <Input
                value={mineQuery}
                onChange={(e) => setMineQuery(e.target.value)}
                placeholder="搜尋我的地點或旅程…"
                className="h-8 shrink-0 text-xs"
              />
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
            </>
          )}

          {layer === "explore" && (
            <ExplorePanel
              query={exploreQuery}
              setQuery={setExploreQuery}
              onSearch={runExploreSearch}
              exploreType={exploreType}
              setExploreType={setExploreType}
              curatedPois={curatedPois}
              googlePlaces={googlePlaces}
              loading={exploreLoading}
              selectedPinId={selectedPinId}
              onSelect={setSelectedPinId}
              hasDestination={Boolean(destination)}
            />
          )}

          {layer === "routes" && (
            <RoutesPanel
              routes={routes}
              loading={routesLoading}
              selectedRouteId={selectedRouteId}
              onSelectRoute={setSelectedRouteId}
              hasDestination={Boolean(destination)}
            />
          )}
        </aside>

        <div className="surface-tile relative min-h-[420px] overflow-hidden lg:col-span-9">
          <TripMapCanvas
            destination={activeDestination}
            pins={activePins}
            dayRoutes={activeRoutes}
            selectedPinId={selectedPinId}
            onPinSelect={(p) => setSelectedPinId(p.id)}
            mapTypeId={basemap}
          />

          {layer === "mine" && selectedMinePlace && (
            <DetailFloater
              place={selectedMinePlace}
              tripColor={tripColorById.get(selectedMinePlace.tripId) ?? "#3b82f6"}
              onClose={() => setSelectedPinId(null)}
            />
          )}
          {layer !== "mine" && selectedPin && (
            <PinFloater pin={selectedPin} onClose={() => setSelectedPinId(null)} />
          )}

          {activePins.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center bg-[var(--surface-sunken)]/30">
              <p className="rounded-lg bg-[var(--surface-raised)] px-4 py-2 text-xs text-[var(--text-muted)] shadow-[var(--shadow-flat)]">
                {emptyMessage(layer, exploreLoading || routesLoading)}
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

function emptyMessage(layer: Layer, loading: boolean): string {
  if (loading) return "載入中…";
  if (layer === "mine") return "沒有符合條件的地點。";
  if (layer === "explore")
    return "此目的地尚無策展地點，試試右上角搜尋 Google 地點。";
  return "此目的地尚無策展路線。";
}

// ─── Header ──────────────────────────────────────────────────────────────────

function Header({
  layer,
  setLayer,
  destinations,
  destination,
  setDestination,
  basemap,
  setBasemap,
  totalTrips,
  shownCount,
}: {
  layer: Layer;
  setLayer: (v: Layer) => void;
  destinations: Destination[];
  destination: string | null;
  setDestination: (v: string) => void;
  basemap: Basemap;
  setBasemap: (v: Basemap) => void;
  totalTrips: number;
  shownCount: number;
}) {
  const needsDestination = layer !== "mine";
  return (
    <header className="surface-tile flex shrink-0 flex-wrap items-center gap-2 p-2">
      <span className="text-sm font-semibold">🧭 探索地圖</span>

      <div className="flex items-center gap-1">
        <LayerTab
          active={layer === "mine"}
          onClick={() => setLayer("mine")}
          label="我的地點"
        />
        <LayerTab
          active={layer === "explore"}
          onClick={() => setLayer("explore")}
          label="探索 POI"
        />
        <LayerTab
          active={layer === "routes"}
          onClick={() => setLayer("routes")}
          label="路線"
        />
      </div>

      {needsDestination && (
        <label className="flex items-center gap-1 text-[11px] text-[var(--text-muted)]">
          <span>目的地</span>
          <select
            value={destination ?? ""}
            onChange={(e) => setDestination(e.target.value)}
            className="rounded-md border border-[var(--border-hairline)] bg-[var(--surface-raised)] px-2 py-1 text-xs"
          >
            {destinations.length === 0 && <option value="">無可用目的地</option>}
            {destinations.map((d) => (
              <option key={d.name} value={d.name}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <span className="text-mono text-[11px] text-[var(--text-muted)]">
        {layer === "mine"
          ? `${totalTrips} 趟旅程 · ${shownCount} 個地點`
          : `${shownCount} 個地點`}
      </span>

      <div className="ml-auto flex flex-wrap items-center gap-1.5">
        {(["roadmap", "satellite", "hybrid"] as const).map((b) => (
          <Chip
            key={b}
            active={basemap === b}
            onClick={() => setBasemap(b)}
            label={b === "roadmap" ? "地圖" : b === "satellite" ? "衛星" : "混合"}
          />
        ))}
      </div>
    </header>
  );
}

// ─── Explore panel (left rail) ─────────────────────────────────────────────────

function ExplorePanel({
  query,
  setQuery,
  onSearch,
  exploreType,
  setExploreType,
  curatedPois,
  googlePlaces,
  loading,
  selectedPinId,
  onSelect,
  hasDestination,
}: {
  query: string;
  setQuery: (v: string) => void;
  onSearch: () => void;
  exploreType: TypeFilter;
  setExploreType: (v: TypeFilter) => void;
  curatedPois: ExplorePoi[];
  googlePlaces: NearbyPlace[];
  loading: boolean;
  selectedPinId: string | null;
  onSelect: (id: string) => void;
  hasDestination: boolean;
}) {
  const curated = curatedPois.filter(
    (p) => exploreType === "all" || p.itemType === exploreType
  );
  const google = googlePlaces.filter(
    (g) =>
      exploreType === "all" ||
      inferItemTypeFromGoogleType(g.primaryType) === exploreType
  );

  return (
    <>
      <section className="surface-tile shrink-0 p-2">
        <div className="flex gap-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="想找什麼？例如「溫泉」「拉麵」"
            className="h-8 text-xs"
            disabled={!hasDestination}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onSearch();
              }
            }}
          />
          <Button
            type="button"
            size="sm"
            className="h-8"
            onClick={onSearch}
            disabled={!hasDestination}
          >
            搜尋
          </Button>
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1">
          <Chip
            active={exploreType === "all"}
            onClick={() => setExploreType("all")}
            label="全部"
          />
          {(["hotel", "restaurant", "activity", "transport"] as const).map((t) => (
            <Chip
              key={t}
              active={exploreType === t}
              onClick={() => setExploreType(t)}
              label={`${TYPE_GLYPH[t]} ${TYPE_LABEL[t]}`}
            />
          ))}
        </div>
      </section>

      <section className="surface-tile flex-1 overflow-y-auto">
        {loading && (
          <p className="p-4 text-center text-xs text-[var(--text-muted)]">
            載入策展地點中…
          </p>
        )}
        {!loading && curated.length === 0 && google.length === 0 && (
          <p className="p-6 text-center text-xs text-[var(--text-muted)]">
            此目的地尚無策展地點。輸入關鍵字搜尋 Google 地點。
          </p>
        )}

        {curated.length > 0 && (
          <>
            <p className="px-3 pt-2 text-caps">策展地點 · {curated.length}</p>
            <ul className="divide-y divide-[var(--border-hairline)]">
              {curated.map((p) => (
                <ExploreRow
                  key={p.placeId}
                  id={`poi:${p.placeId}`}
                  glyph={TYPE_GLYPH[p.itemType] ?? "📌"}
                  title={p.name}
                  subtitle={p.description || null}
                  badge="策展"
                  tags={p.tags}
                  selected={selectedPinId === `poi:${p.placeId}`}
                  onSelect={onSelect}
                />
              ))}
            </ul>
          </>
        )}

        {google.length > 0 && (
          <>
            <p className="px-3 pt-3 text-caps">Google 搜尋 · {google.length}</p>
            <ul className="divide-y divide-[var(--border-hairline)]">
              {google.map((g) => (
                <ExploreRow
                  key={g.placeId}
                  id={`gplace:${g.placeId}`}
                  glyph={
                    TYPE_GLYPH[inferItemTypeFromGoogleType(g.primaryType)] ?? "📌"
                  }
                  title={g.name}
                  subtitle={g.address}
                  badge={g.rating != null ? `⭐ ${g.rating.toFixed(1)}` : "Google"}
                  selected={selectedPinId === `gplace:${g.placeId}`}
                  onSelect={onSelect}
                />
              ))}
            </ul>
          </>
        )}
      </section>
    </>
  );
}

function ExploreRow({
  id,
  glyph,
  title,
  subtitle,
  badge,
  tags,
  selected,
  onSelect,
}: {
  id: string;
  glyph: string;
  title: string;
  subtitle: string | null;
  badge: string;
  tags?: string[];
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(id)}
        className={cn(
          "flex w-full items-start gap-2 px-3 py-2 text-left transition-colors hover:bg-[var(--surface-sunken)]/60",
          selected && "bg-[var(--accent-line-soft)]"
        )}
      >
        <span
          aria-hidden
          className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-sunken)] text-base"
        >
          {glyph}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="truncate text-sm font-medium">{title}</p>
            <Badge variant="secondary" className="shrink-0 text-[9px]">
              {badge}
            </Badge>
          </div>
          {subtitle && (
            <p className="line-clamp-2 text-[11px] text-[var(--text-muted)]">
              {subtitle}
            </p>
          )}
          {tags && tags.length > 0 && (
            <p className="mt-0.5 truncate text-[10px] text-[var(--text-faint)]">
              {tags.slice(0, 4).map((t) => `#${t}`).join(" ")}
            </p>
          )}
        </div>
      </button>
    </li>
  );
}

// ─── Routes panel (left rail) ──────────────────────────────────────────────────

function RoutesPanel({
  routes,
  loading,
  selectedRouteId,
  onSelectRoute,
  hasDestination,
}: {
  routes: ExploreRoute[];
  loading: boolean;
  selectedRouteId: string | null;
  onSelectRoute: (id: string) => void;
  hasDestination: boolean;
}) {
  if (!hasDestination) {
    return (
      <section className="surface-tile flex-1 p-6 text-center text-xs text-[var(--text-muted)]">
        選擇目的地以瀏覽策展路線。
      </section>
    );
  }
  if (loading) {
    return (
      <section className="surface-tile flex-1 p-6 text-center text-xs text-[var(--text-muted)]">
        載入路線中…
      </section>
    );
  }
  if (routes.length === 0) {
    return (
      <section className="surface-tile flex-1 border-dashed p-6 text-center text-xs text-[var(--text-muted)]">
        此目的地尚無策展路線。
      </section>
    );
  }
  return (
    <section className="surface-tile flex-1 overflow-y-auto">
      <p className="px-3 pt-2 text-caps">策展路線 · {routes.length}</p>
      <ul className="space-y-2 p-2">
        {routes.map((r) => {
          const active = selectedRouteId === r.routeId;
          return (
            <li key={r.routeId}>
              <button
                type="button"
                onClick={() => onSelectRoute(r.routeId)}
                className={cn(
                  "w-full rounded-lg border p-2.5 text-left transition-colors",
                  active
                    ? "border-[var(--accent-line)] bg-[var(--accent-line-soft)]"
                    : "border-[var(--border-hairline)] hover:bg-[var(--surface-sunken)]/60"
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold">{r.title}</p>
                  <Badge variant="secondary" className="shrink-0 text-[9px]">
                    {r.places.length} 站
                  </Badge>
                </div>
                <p className="mt-1 line-clamp-2 text-[11px] text-[var(--text-muted)]">
                  {r.summary}
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[10px] text-[var(--text-faint)]">
                  <span className="rounded-full bg-[var(--surface-sunken)] px-1.5 py-0.5">
                    {PACE_LABEL[r.pace] ?? r.pace}
                  </span>
                  {r.vibeTags.slice(0, 3).map((t) => (
                    <span key={t}>#{t}</span>
                  ))}
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ─── Trip legend (my places) ───────────────────────────────────────────────────

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

// ─── Filter tile (my places) ───────────────────────────────────────────────────

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

// ─── Place list (my places) ────────────────────────────────────────────────────

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

// ─── Detail floater: my places (over the map) ──────────────────────────────────

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

// ─── Pin floater: explore / routes (over the map) ──────────────────────────────

function PinFloater({ pin, onClose }: { pin: MapPin; onClose: () => void }) {
  const gMapsUrl =
    pin.bookingUrl ??
    `https://www.google.com/maps/search/?api=1&query=${pin.lat},${pin.lng}`;
  return (
    <div className="surface-glass absolute right-3 top-3 w-72 rounded-lg p-3 shadow-[var(--shadow-flat)]">
      <div className="flex items-start gap-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--surface-sunken)] text-xl">
          {TYPE_GLYPH[pin.itemType] ?? "📌"}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{pin.title}</p>
          <p className="mt-0.5 text-[10px] uppercase text-[var(--text-muted)]">
            {TYPE_LABEL[pin.itemType] ?? pin.itemType}
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
      {pin.subtitle && (
        <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-muted)]">
          {pin.subtitle}
        </p>
      )}
      <div className="text-mono mt-2 text-[10px] text-[var(--text-muted)]">
        {pin.lat.toFixed(5)}, {pin.lng.toFixed(5)}
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
      </div>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function inferItemTypeFromGoogleType(
  primary: string | null | undefined
): "hotel" | "restaurant" | "activity" | "transport" {
  if (!primary) return "activity";
  if (primary.includes("lodging") || primary.includes("hotel")) return "hotel";
  if (
    primary.includes("restaurant") ||
    primary.includes("cafe") ||
    primary.includes("food") ||
    primary.includes("bar")
  )
    return "restaurant";
  if (
    primary.includes("station") ||
    primary.includes("transit") ||
    primary.includes("airport")
  )
    return "transport";
  return "activity";
}

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

function LayerTab({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors",
        active
          ? "bg-[var(--text-primary)] text-[var(--surface-raised)]"
          : "text-[var(--text-muted)] hover:bg-[var(--surface-sunken)]"
      )}
    >
      {label}
    </button>
  );
}

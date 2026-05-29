"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { appFetchJson, AppApiFetchError } from "@/lib/app-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { TabError, TabSkeleton } from "@/components/app/tab-shell";
import type {
  ItineraryEntry,
  ItineraryResponse,
} from "@/app/api/app/trips/[tripId]/itinerary/route";
import type { WebVotesResponse } from "@/app/api/app/trips/[tripId]/votes/route";
import type { MemoriesResponse } from "@/app/api/app/trips/[tripId]/memories/route";
import type { MapPin, DayRoute } from "@/components/app/trip-map-canvas";
import type { PlaceAutocompleteSuggestion } from "@/app/api/app/places/autocomplete/route";
import type { NearbyPlace, NearbyResponse } from "@/app/api/app/places/nearby/route";
import type {
  DirectionsResponse,
  TravelMode,
} from "@/app/api/app/places/directions/route";
import type { DistanceMatrixResponse } from "@/app/api/app/places/distance-matrix/route";

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

// ─── Constants ────────────────────────────────────────────────────────────────

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

const MODE_LABEL: Record<TravelMode, string> = {
  WALK: "🚶 步行",
  DRIVE: "🚗 開車",
  BICYCLE: "🚴 自行車",
  TRANSIT: "🚆 大眾運輸",
};

type TypeFilter = "all" | "hotel" | "restaurant" | "activity" | "transport";
type StageFilter = "all" | "confirmed" | "pending" | "shared";
type Basemap = "roadmap" | "satellite" | "hybrid";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function dateKey(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toISOString().split("T")[0];
}

function dayLabel(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("zh-TW", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function formatTimeOfDay(iso: string | null | undefined): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleTimeString("zh-TW", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatMeters(meters: number | null | undefined): string {
  if (meters == null) return "—";
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null) return "—";
  if (seconds < 60) return `${seconds}s`;
  const min = Math.round(seconds / 60);
  if (min < 60) return `${min} 分`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h} 小時` : `${h} 小時 ${m} 分`;
}

// ─── Build pins from itinerary + votes + memories ─────────────────────────────

function buildPins(
  itinerary: ItineraryResponse,
  votes: WebVotesResponse,
  memories: MemoriesResponse
): MapPin[] {
  const pins: MapPin[] = [];

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
      deadlineAt: item.deadline_at,
      bookingUrl: opt.booking_url,
    });
  }

  const itemById = new Map<string, ItineraryEntry>(
    itinerary.items.map((i) => [i.id, i])
  );
  for (const vote of votes.votes) {
    const dayK =
      itemById.get(vote.item.id)?.deadline_at != null
        ? dateKey(itemById.get(vote.item.id)!.deadline_at)
        : dateKey(vote.item.deadlineAt);
    const voteDeadline =
      itemById.get(vote.item.id)?.deadline_at ?? vote.item.deadlineAt ?? null;
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
        deadlineAt: voteDeadline,
        votedByMe: opt.votedByMe,
        bookingUrl: opt.bookingUrl,
      });
    }
  }

  const occupied = new Set<string>();
  for (const p of pins) {
    occupied.add(`${p.lat.toFixed(5)},${p.lng.toFixed(5)}|${p.title}`);
  }
  for (const mem of memories.memories) {
    const key = `${mem.lat.toFixed(5)},${mem.lng.toFixed(5)}|${mem.title}`;
    if (occupied.has(key)) continue;
    pins.push({
      id: `memory:${mem.id}`,
      lat: mem.lat,
      lng: mem.lng,
      title: mem.title,
      subtitle: mem.address,
      itemType: mem.itemType,
      stage: "shared",
      kind: "memory",
      itemId: null,
      optionId: null,
      dayKey: null,
      bookingUrl: mem.bookingUrl,
    });
  }

  return pins;
}

// ─── Main component ──────────────────────────────────────────────────────────

interface MapData {
  itinerary: ItineraryResponse;
  votes: WebVotesResponse;
  memories: MemoriesResponse;
}

export function MainMapPage({
  tripId,
  canEdit,
}: {
  tripId: string;
  canEdit: boolean;
}) {
  const [data, setData] = useState<MapData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [stageFilter, setStageFilter] = useState<StageFilter>("all");
  const [dayFilter, setDayFilter] = useState<string>("all");
  const [showRoutes, setShowRoutes] = useState(true);
  const [selectedPinId, setSelectedPinId] = useState<string | null>(null);

  const [basemap, setBasemap] = useState<Basemap>("roadmap");
  const [travelMode, setTravelMode] = useState<TravelMode>("WALK");

  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<NearbyPlace[]>([]);
  const [searching, setSearching] = useState(false);

  // Directions overlay for the currently-selected day
  const [encodedPolyline, setEncodedPolyline] = useState<string | null>(null);
  const [directionsTotal, setDirectionsTotal] =
    useState<DirectionsResponse | null>(null);

  // Hop-to-hop distance matrix for the day plan rail
  const [matrix, setMatrix] = useState<DistanceMatrixResponse | null>(null);

  // Right rail panel mode
  const [rightPanel, setRightPanel] = useState<"detail" | "search" | "plan">(
    "plan"
  );

  const load = useCallback(async () => {
    try {
      const [itinerary, votes, memories] = await Promise.all([
        appFetchJson<ItineraryResponse>(`/api/app/trips/${tripId}/itinerary`),
        appFetchJson<WebVotesResponse>(`/api/app/trips/${tripId}/votes`),
        appFetchJson<MemoriesResponse>(`/api/app/trips/${tripId}/memories`),
      ]);
      setError(null);
      setData({ itinerary, votes, memories });
    } catch (err) {
      setError(
        err instanceof AppApiFetchError
          ? err.message
          : err instanceof Error
            ? err.message
            : "地圖資料載入失敗"
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
    return buildPins(data.itinerary, data.votes, data.memories);
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

  // Pins selected for the active day, ordered as in the itinerary. Drives
  // the Day Plan rail and the on-demand directions overlay.
  const selectedDayPins = useMemo<MapPin[]>(() => {
    if (dayFilter === "all" || dayFilter === "unscheduled" || !data) return [];
    const items = data.itinerary.items;
    const inDay = filteredPins.filter(
      (p) => p.kind === "item" && p.stage === "confirmed" && p.dayKey === dayFilter
    );
    return inDay.slice().sort((a, b) => {
      const ai = items.findIndex((it) => it.id === a.itemId);
      const bi = items.findIndex((it) => it.id === b.itemId);
      return ai - bi;
    });
  }, [dayFilter, filteredPins, data]);

  const destination = useMemo(() => {
    if (!data) return { name: null, lat: null, lng: null };
    const name = data.itinerary.trip.destination_name;
    const firstConfirmed = data.itinerary.items.find(
      (i) =>
        i.stage === "confirmed" &&
        i.confirmed_option?.lat != null &&
        i.confirmed_option?.lng != null
    );
    return {
      name,
      lat: firstConfirmed?.confirmed_option?.lat ?? null,
      lng: firstConfirmed?.confirmed_option?.lng ?? null,
    };
  }, [data]);

  // Fetch directions whenever the selected day's pin sequence changes.
  useEffect(() => {
    let cancelled = false;
    setEncodedPolyline(null);
    setDirectionsTotal(null);
    setMatrix(null);

    if (selectedDayPins.length < 2) return;

    const origin = selectedDayPins[0];
    const destinationPin = selectedDayPins[selectedDayPins.length - 1];
    const waypoints = selectedDayPins
      .slice(1, -1)
      .map((p) => ({ lat: p.lat, lng: p.lng }));

    void (async () => {
      try {
        const dir = await appFetchJson<DirectionsResponse>(
          "/api/app/places/directions",
          {
            method: "POST",
            body: JSON.stringify({
              origin: { lat: origin.lat, lng: origin.lng },
              destination: { lat: destinationPin.lat, lng: destinationPin.lng },
              waypoints,
              mode: travelMode,
            }),
          }
        );
        if (!cancelled) {
          setEncodedPolyline(dir.polyline);
          setDirectionsTotal(dir);
        }
      } catch {
        // Routes API can fail (e.g. no transit between hops); fall back to
        // the dashed haversine polylines silently.
      }

      try {
        const points = selectedDayPins.map((p) => ({ lat: p.lat, lng: p.lng }));
        // Pairwise hops only: origins = points[0..n-2], destinations = points[1..n-1]
        // We request the full N×N then read the diagonal below for hop-to-hop times.
        const m = await appFetchJson<DistanceMatrixResponse>(
          "/api/app/places/distance-matrix",
          {
            method: "POST",
            body: JSON.stringify({
              origins: points.slice(0, -1),
              destinations: points.slice(1),
              mode: travelMode,
            }),
          }
        );
        if (!cancelled) setMatrix(m);
      } catch {
        // Non-fatal — Day Plan rail falls back to straight-line distance.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedDayPins, travelMode]);

  // Place search: typed query → text/nearby search around the destination.
  const runSearch = useCallback(async () => {
    if (destination.lat == null || destination.lng == null) {
      setError("尚未設定旅程目的地座標");
      return;
    }
    setSearching(true);
    try {
      const res = await appFetchJson<NearbyResponse>(
        "/api/app/places/nearby",
        {
          method: "POST",
          body: JSON.stringify({
            q: searchQuery.trim() || undefined,
            lat: destination.lat,
            lng: destination.lng,
            radius: 5000,
            category:
              typeFilter === "all" ? "any" : typeFilter,
            limit: 12,
          }),
        }
      );
      setSearchResults(res.places);
      setRightPanel("search");
    } catch (err) {
      setError(
        err instanceof AppApiFetchError ? err.message : "搜尋失敗"
      );
    } finally {
      setSearching(false);
    }
  }, [destination.lat, destination.lng, searchQuery, typeFilter]);

  // Add a search result to the itinerary as a confirmed item with a place.
  const handleAddToItinerary = useCallback(
    async (place: NearbyPlace, dayIso: string | null, itemType: string) => {
      try {
        const deadlineAt = dayIso ? new Date(dayIso + "T09:00:00Z").toISOString() : null;
        await appFetchJson(`/api/app/trips/${tripId}/items`, {
          method: "POST",
          body: JSON.stringify({
            action: "create",
            title: place.name,
            itemType,
            itemKind: "task",
            deadlineAt,
            place: {
              name: place.name,
              address: place.address,
              lat: place.lat,
              lng: place.lng,
              googleMapsUrl: place.googleMapsUri,
            },
          }),
        });
        await load();
      } catch (err) {
        setError(
          err instanceof AppApiFetchError ? err.message : "加入行程失敗"
        );
      }
    },
    [tripId, load]
  );

  if (error && !data) {
    return <TabError message={error} onRetry={() => void load()} />;
  }

  if (!data) {
    return <TabSkeleton className="h-[calc(100vh-12rem)]" />;
  }

  const selectedPin = allPins.find((p) => p.id === selectedPinId) ?? null;

  return (
    <div className="-mx-4 -mt-2 flex h-[calc(100vh-7rem)] flex-col gap-2 px-4">
      {/* Top bar: title, day chips, basemap toggle */}
      <TopBar
        tripId={tripId}
        destinationName={destination.name}
        dayKeys={dayKeys}
        dayFilter={dayFilter}
        setDayFilter={setDayFilter}
        dayColorByKey={dayColorByKey}
        basemap={basemap}
        setBasemap={setBasemap}
      />

      {/* Search bar */}
      <SearchBar
        query={searchQuery}
        setQuery={setSearchQuery}
        onSearch={runSearch}
        searching={searching}
        canEdit={canEdit}
      />

      {/* Body: left rail + map + right rail */}
      <div className="grid min-h-0 flex-1 gap-2 lg:grid-cols-12">
        {/* Left rail: filters + pin list */}
        <aside className="flex min-h-0 flex-col gap-2 lg:col-span-3">
          <FilterTile
            typeFilter={typeFilter}
            setTypeFilter={setTypeFilter}
            stageFilter={stageFilter}
            setStageFilter={setStageFilter}
            showRoutes={showRoutes}
            setShowRoutes={setShowRoutes}
            counts={countsFor(allPins)}
            totalPins={allPins.length}
            shownPins={filteredPins.length}
          />
          <PinListTile
            pins={filteredPins}
            selectedPinId={selectedPinId}
            onSelect={(id) => {
              setSelectedPinId(id);
              setRightPanel("detail");
            }}
            dayColorByKey={dayColorByKey}
          />
        </aside>

        {/* Map */}
        <div className="surface-tile relative min-h-[420px] overflow-hidden lg:col-span-6">
          <TripMapCanvas
            destination={destination}
            pins={filteredPins}
            dayRoutes={dayRoutes}
            selectedPinId={selectedPinId}
            onPinSelect={(p) => {
              setSelectedPinId(p.id);
              setRightPanel("detail");
            }}
            encodedPolyline={encodedPolyline}
            mapTypeId={basemap}
          />
          {directionsTotal && selectedDayPins.length >= 2 && (
            <div className="surface-glass absolute left-3 top-3 rounded-lg px-3 py-1.5 text-[11px] font-medium shadow-[var(--shadow-flat)]">
              {MODE_LABEL[directionsTotal.mode]} ·{" "}
              {formatMeters(directionsTotal.totalDistanceMeters)} ·{" "}
              {formatDuration(directionsTotal.totalDurationSeconds)}
            </div>
          )}
        </div>

        {/* Right rail */}
        <aside className="flex min-h-0 flex-col gap-2 lg:col-span-3">
          <div className="surface-tile flex shrink-0 items-center gap-1 p-1.5 text-[11px]">
            <RailTab
              active={rightPanel === "plan"}
              onClick={() => setRightPanel("plan")}
              label="日程"
            />
            <RailTab
              active={rightPanel === "detail"}
              onClick={() => setRightPanel("detail")}
              label="詳細"
              disabled={!selectedPin}
            />
            <RailTab
              active={rightPanel === "search"}
              onClick={() => setRightPanel("search")}
              label="搜尋"
              count={searchResults.length || undefined}
            />
          </div>

          <section className="surface-tile flex-1 overflow-y-auto p-3">
            {rightPanel === "plan" && (
              <DayPlanPanel
                selectedDayPins={selectedDayPins}
                dayFilter={dayFilter}
                travelMode={travelMode}
                setTravelMode={setTravelMode}
                matrix={matrix}
                directionsTotal={directionsTotal}
                onSelectPin={setSelectedPinId}
              />
            )}
            {rightPanel === "detail" && selectedPin && (
              <PinDetailPanel
                pin={selectedPin}
                destination={destination}
              />
            )}
            {rightPanel === "detail" && !selectedPin && (
              <p className="py-8 text-center text-xs text-[var(--text-muted)]">
                點選地圖上的圖釘以查看詳細資訊
              </p>
            )}
            {rightPanel === "search" && (
              <SearchPanel
                results={searchResults}
                onAdd={handleAddToItinerary}
                dayKeys={dayKeys}
                canEdit={canEdit}
                searching={searching}
                onClear={() => {
                  setSearchResults([]);
                  setSearchQuery("");
                }}
              />
            )}
          </section>
        </aside>
      </div>

      {error && data && (
        <div className="surface-tile shrink-0 border border-red-500/40 p-2 text-xs text-red-500">
          {error}
        </div>
      )}
    </div>
  );
}

// ─── Top bar ──────────────────────────────────────────────────────────────────

function TopBar({
  tripId,
  destinationName,
  dayKeys,
  dayFilter,
  setDayFilter,
  dayColorByKey,
  basemap,
  setBasemap,
}: {
  tripId: string;
  destinationName: string | null;
  dayKeys: string[];
  dayFilter: string;
  setDayFilter: (v: string) => void;
  dayColorByKey: Map<string, string>;
  basemap: Basemap;
  setBasemap: (v: Basemap) => void;
}) {
  return (
    <header className="surface-tile flex shrink-0 flex-wrap items-center gap-2 p-2">
      <Link
        href={`/app/trips/${tripId}`}
        className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
      >
        ← 回行程
      </Link>
      <span aria-hidden className="text-[var(--text-faint)]">·</span>
      <span className="text-sm font-semibold">
        🗺 主地圖{destinationName ? ` · ${destinationName}` : ""}
      </span>

      <div className="ml-auto flex flex-wrap items-center gap-1">
        <Chip
          active={dayFilter === "all"}
          onClick={() => setDayFilter("all")}
          label="全部"
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

        <span aria-hidden className="mx-1 text-[var(--text-faint)]">|</span>

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

// ─── Search bar ───────────────────────────────────────────────────────────────

function SearchBar({
  query,
  setQuery,
  onSearch,
  searching,
  canEdit,
}: {
  query: string;
  setQuery: (v: string) => void;
  onSearch: () => void;
  searching: boolean;
  canEdit: boolean;
}) {
  const [suggestions, setSuggestions] = useState<PlaceAutocompleteSuggestion[]>(
    []
  );
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const trimmed = query.trim();
      if (trimmed.length < 2) {
        setSuggestions([]);
        return;
      }
      try {
        const res = await appFetchJson<{
          suggestions: PlaceAutocompleteSuggestion[];
        }>(`/api/app/places/autocomplete?q=${encodeURIComponent(trimmed)}`);
        setSuggestions(res.suggestions ?? []);
      } catch {
        setSuggestions([]);
      }
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  // Hide suggestions purely from props rather than calling setState in an
  // effect; this keeps the lint rule happy and avoids cascading renders.
  const visibleSuggestions =
    query.trim().length >= 2 ? suggestions : [];

  return (
    <div className="surface-tile relative shrink-0 p-2">
      <div className="flex gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={
            canEdit
              ? "搜尋地點、餐廳、景點… 例如「澀谷拉麵」"
              : "搜尋地點（僅檢視）"
          }
          className="h-9 text-sm"
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
          onClick={onSearch}
          disabled={searching}
        >
          {searching ? "搜尋中…" : "在地圖搜尋"}
        </Button>
      </div>
      {visibleSuggestions.length > 0 && (
        <ul className="surface-tile absolute left-2 right-2 top-[calc(100%-2px)] z-20 mt-1 max-h-60 overflow-y-auto border border-[var(--border-hairline)] shadow-[var(--shadow-flat)]">
          {visibleSuggestions.map((s) => (
            <li key={s.placeId}>
              <button
                type="button"
                onClick={() => {
                  setQuery(s.primaryText);
                  setSuggestions([]);
                  onSearch();
                }}
                className="flex w-full flex-col gap-0.5 px-3 py-2 text-left text-xs hover:bg-[var(--surface-sunken)]/60"
              >
                <span className="font-medium">{s.primaryText}</span>
                {s.secondaryText && (
                  <span className="text-[var(--text-muted)]">
                    {s.secondaryText}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Filter tile ──────────────────────────────────────────────────────────────

function FilterTile({
  typeFilter,
  setTypeFilter,
  stageFilter,
  setStageFilter,
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
  showRoutes: boolean;
  setShowRoutes: (v: boolean) => void;
  counts: Record<string, number>;
  totalPins: number;
  shownPins: number;
}) {
  return (
    <section className="surface-tile shrink-0 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-caps">篩選</p>
        <p className="text-mono text-[10px] text-[var(--text-muted)]">
          {shownPins} / {totalPins}
        </p>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1">
        <Chip
          active={typeFilter === "all"}
          onClick={() => setTypeFilter("all")}
          label="全部"
          count={totalPins}
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
      <label className="mt-2 flex items-center gap-2 text-[11px] text-[var(--text-muted)]">
        <input
          type="checkbox"
          checked={showRoutes}
          onChange={(e) => setShowRoutes(e.target.checked)}
          className="h-3.5 w-3.5 rounded border-[var(--border-hairline)]"
        />
        顯示每日路線
      </label>
    </section>
  );
}

// ─── Pin list tile ────────────────────────────────────────────────────────────

function PinListTile({
  pins,
  selectedPinId,
  onSelect,
  dayColorByKey,
}: {
  pins: MapPin[];
  selectedPinId: string | null;
  onSelect: (pinId: string) => void;
  dayColorByKey: Map<string, string>;
}) {
  if (pins.length === 0) {
    return (
      <section className="surface-tile flex-1 border-dashed p-6 text-center text-xs text-[var(--text-muted)]">
        沒有符合條件的地點。
      </section>
    );
  }
  return (
    <section className="surface-tile flex-1 overflow-y-auto">
      <ul className="divide-y divide-[var(--border-hairline)]">
        {pins.map((pin) => {
          const dayColor = pin.dayKey ? dayColorByKey.get(pin.dayKey) : null;
          return (
            <li key={pin.id}>
              <button
                type="button"
                onClick={() => onSelect(pin.id)}
                className={cn(
                  "flex w-full items-start gap-2 px-3 py-2 text-left transition-colors hover:bg-[var(--surface-sunken)]/60",
                  selectedPinId === pin.id && "bg-[var(--accent-line-soft)]"
                )}
              >
                <span
                  aria-hidden
                  className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-sunken)] text-base"
                  style={
                    dayColor ? { boxShadow: `inset 0 0 0 2px ${dayColor}` } : undefined
                  }
                >
                  {TYPE_GLYPH[pin.itemType] ?? "📌"}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="truncate text-sm font-medium">{pin.title}</p>
                    <Badge
                      variant="secondary"
                      className="shrink-0 text-[9px] uppercase"
                    >
                      {STAGE_LABEL[pin.stage] ?? pin.stage}
                    </Badge>
                  </div>
                  {formatTimeOfDay(pin.deadlineAt) && (
                    <p className="text-mono text-[10px] font-semibold tabular-nums text-[var(--text-primary)]">
                      🕒 {formatTimeOfDay(pin.deadlineAt)}
                    </p>
                  )}
                  {pin.subtitle && (
                    <p className="truncate text-[11px] text-[var(--text-muted)]">
                      📍 {pin.subtitle}
                    </p>
                  )}
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ─── Day plan panel (right rail) ──────────────────────────────────────────────

function DayPlanPanel({
  selectedDayPins,
  dayFilter,
  travelMode,
  setTravelMode,
  matrix,
  directionsTotal,
  onSelectPin,
}: {
  selectedDayPins: MapPin[];
  dayFilter: string;
  travelMode: TravelMode;
  setTravelMode: (m: TravelMode) => void;
  matrix: DistanceMatrixResponse | null;
  directionsTotal: DirectionsResponse | null;
  onSelectPin: (id: string) => void;
}) {
  if (dayFilter === "all" || dayFilter === "unscheduled") {
    return (
      <div className="space-y-2">
        <p className="text-caps">日程</p>
        <p className="text-xs text-[var(--text-muted)]">
          選擇上方的日期可在這裡顯示當日逐站行程與步行 / 大眾運輸時間。
        </p>
      </div>
    );
  }

  if (selectedDayPins.length === 0) {
    return (
      <p className="py-8 text-center text-xs text-[var(--text-muted)]">
        當日尚無已確認地點。
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-caps">當日行程</p>
        <p className="text-mono text-[10px] text-[var(--text-muted)]">
          {selectedDayPins.length} 站
        </p>
      </div>

      <div className="flex flex-wrap gap-1">
        {(["WALK", "TRANSIT", "DRIVE", "BICYCLE"] as const).map((m) => (
          <Chip
            key={m}
            active={travelMode === m}
            onClick={() => setTravelMode(m)}
            label={MODE_LABEL[m]}
          />
        ))}
      </div>

      {directionsTotal && (
        <div className="rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-sunken)]/40 p-2 text-[11px]">
          <p className="font-medium">
            總計 · {formatMeters(directionsTotal.totalDistanceMeters)} ·{" "}
            {formatDuration(directionsTotal.totalDurationSeconds)}
          </p>
        </div>
      )}

      <ol className="space-y-1.5">
        {selectedDayPins.map((pin, i) => {
          // Hop time from pin[i] → pin[i+1] sits in the matrix at
          // origin=i, destination=i (origins are slice(0,-1), destinations are slice(1)).
          const hop = matrix?.cells.find(
            (c) =>
              c.originIndex === i && c.destinationIndex === i && c.status === "OK"
          );
          const hasNext = i < selectedDayPins.length - 1;
          const scheduled = formatTimeOfDay(pin.deadlineAt);
          // ETA = anchor (first stop's scheduled time) + cumulative hop seconds.
          // Falls back to null when we have no anchor, no matrix, or any
          // intermediate hop is missing.
          const anchorIso = selectedDayPins[0]?.deadlineAt ?? null;
          let etaIso: string | null = null;
          if (anchorIso && i > 0 && matrix) {
            const anchorMs = new Date(anchorIso).getTime();
            let cumulative = 0;
            let ok = true;
            for (let j = 0; j < i; j++) {
              const seg = matrix.cells.find(
                (c) =>
                  c.originIndex === j &&
                  c.destinationIndex === j &&
                  c.status === "OK"
              );
              if (!seg || seg.durationSeconds == null) {
                ok = false;
                break;
              }
              cumulative += seg.durationSeconds;
            }
            if (ok) etaIso = new Date(anchorMs + cumulative * 1000).toISOString();
          }
          const eta = formatTimeOfDay(etaIso);
          // Delay vs scheduled, only if we have both — flags tight transitions.
          let delayMin: number | null = null;
          if (etaIso && pin.deadlineAt && i > 0) {
            delayMin = Math.round(
              (new Date(etaIso).getTime() - new Date(pin.deadlineAt).getTime()) /
                60000
            );
          }
          return (
            <li key={pin.id} className="space-y-1">
              <button
                type="button"
                onClick={() => onSelectPin(pin.id)}
                className="flex w-full gap-2 rounded-md p-1.5 text-left hover:bg-[var(--surface-sunken)]/60"
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--text-primary)] text-[10px] font-semibold text-[var(--surface-raised)]">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-1.5">
                    {scheduled ? (
                      <span className="text-mono shrink-0 text-[11px] font-semibold tabular-nums text-[var(--text-primary)]">
                        {scheduled}
                      </span>
                    ) : (
                      <span className="text-mono shrink-0 text-[10px] text-[var(--text-faint)]">
                        --:--
                      </span>
                    )}
                    <span className="truncate text-xs font-medium">
                      {TYPE_GLYPH[pin.itemType] ?? "📌"} {pin.title}
                    </span>
                  </span>
                  {pin.subtitle && (
                    <span className="block truncate pl-9 text-[10px] text-[var(--text-muted)]">
                      {pin.subtitle}
                    </span>
                  )}
                  {eta && i > 0 && (
                    <span className="block pl-9 text-[10px] text-[var(--text-muted)]">
                      預計抵達 {eta}
                      {delayMin != null && Math.abs(delayMin) >= 5 && (
                        <span
                          className={cn(
                            "ml-1 font-medium",
                            delayMin > 0 ? "text-red-500" : "text-emerald-600"
                          )}
                        >
                          ({delayMin > 0 ? "+" : ""}
                          {delayMin} 分)
                        </span>
                      )}
                    </span>
                  )}
                </span>
              </button>
              {hasNext && (
                <div className="ml-3 flex items-center gap-1 border-l-2 border-dashed border-[var(--border-hairline)] pl-3 text-[10px] text-[var(--text-muted)]">
                  <span aria-hidden>↓</span>
                  {hop ? (
                    <span>
                      {formatDuration(hop.durationSeconds)} ·{" "}
                      {formatMeters(hop.distanceMeters)}
                    </span>
                  ) : (
                    <span>計算中…</span>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// ─── Pin detail panel (right rail) ────────────────────────────────────────────

function PinDetailPanel({
  pin,
  destination,
}: {
  pin: MapPin;
  destination: { name: string | null; lat: number | null; lng: number | null };
}) {
  const gMapsUrl = pin.bookingUrl?.includes("google.com/maps")
    ? pin.bookingUrl
    : `https://www.google.com/maps/search/?api=1&query=${pin.lat},${pin.lng}`;
  const dirUrl =
    destination.lat != null && destination.lng != null
      ? `https://www.google.com/maps/dir/?api=1&origin=${destination.lat},${destination.lng}&destination=${pin.lat},${pin.lng}`
      : `https://www.google.com/maps/dir/?api=1&destination=${pin.lat},${pin.lng}`;

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--surface-sunken)] text-xl">
          {TYPE_GLYPH[pin.itemType] ?? "📌"}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{pin.title}</p>
          <p className="mt-0.5 text-[11px] uppercase text-[var(--text-muted)]">
            {TYPE_LABEL[pin.itemType] ?? pin.itemType} ·{" "}
            {STAGE_LABEL[pin.stage] ?? pin.stage}
          </p>
        </div>
      </div>

      {pin.subtitle && (
        <p className="text-xs leading-relaxed text-[var(--text-muted)]">
          📍 {pin.subtitle}
        </p>
      )}

      {formatTimeOfDay(pin.deadlineAt) && (
        <p className="text-mono text-xs font-semibold tabular-nums text-[var(--text-primary)]">
          🕒 {pin.dayKey ? `${dayLabel(pin.dayKey)} · ` : ""}
          {formatTimeOfDay(pin.deadlineAt)}
        </p>
      )}

      <div className="text-mono text-[10px] text-[var(--text-muted)]">
        {pin.lat.toFixed(5)}, {pin.lng.toFixed(5)}
      </div>

      <div className="flex flex-col gap-1.5">
        <a
          href={gMapsUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center justify-center gap-1 rounded-md border border-[var(--border-hairline)] px-3 py-1.5 text-xs hover:bg-[var(--surface-sunken)]/60"
        >
          在 Google Maps 開啟 ↗
        </a>
        <a
          href={dirUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center justify-center gap-1 rounded-md border border-[var(--border-hairline)] px-3 py-1.5 text-xs hover:bg-[var(--surface-sunken)]/60"
        >
          取得導航 ↗
        </a>
        {pin.bookingUrl && (
          <a
            href={pin.bookingUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center gap-1 rounded-md bg-[var(--text-primary)] px-3 py-1.5 text-xs text-[var(--surface-raised)] hover:opacity-90"
          >
            訂位 / 預訂 ↗
          </a>
        )}
      </div>
    </div>
  );
}

// ─── Search panel (right rail) ────────────────────────────────────────────────

function SearchPanel({
  results,
  onAdd,
  dayKeys,
  canEdit,
  searching,
  onClear,
}: {
  results: NearbyPlace[];
  onAdd: (place: NearbyPlace, dayIso: string | null, itemType: string) => void;
  dayKeys: string[];
  canEdit: boolean;
  searching: boolean;
  onClear: () => void;
}) {
  if (results.length === 0) {
    return (
      <div className="space-y-2">
        <p className="text-caps">搜尋結果</p>
        <p className="text-xs text-[var(--text-muted)]">
          {searching ? "搜尋中…" : "在上方輸入關鍵字後按「在地圖搜尋」。"}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-caps">搜尋結果 · {results.length}</p>
        <button
          type="button"
          onClick={onClear}
          className="text-[10px] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
        >
          清除
        </button>
      </div>
      <ul className="space-y-2">
        {results.map((p) => (
          <SearchResultRow
            key={p.placeId}
            place={p}
            onAdd={onAdd}
            dayKeys={dayKeys}
            canEdit={canEdit}
          />
        ))}
      </ul>
    </div>
  );
}

function SearchResultRow({
  place,
  onAdd,
  dayKeys,
  canEdit,
}: {
  place: NearbyPlace;
  onAdd: (place: NearbyPlace, dayIso: string | null, itemType: string) => void;
  dayKeys: string[];
  canEdit: boolean;
}) {
  const [dayIso, setDayIso] = useState<string>("unscheduled");
  const inferredType = inferItemTypeFromGoogleType(place.primaryType);

  return (
    <li className="rounded-lg border border-[var(--border-hairline)] p-2">
      <p className="text-sm font-medium">{place.name}</p>
      {place.address && (
        <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">
          📍 {place.address}
        </p>
      )}
      <p className="mt-1 text-[10px] text-[var(--text-muted)]">
        {place.rating != null && <>⭐ {place.rating.toFixed(1)} </>}
        {place.userRatingCount != null && (
          <>({place.userRatingCount.toLocaleString()}) </>
        )}
        {place.primaryType && <>· {place.primaryType.replace(/_/g, " ")}</>}
      </p>
      {canEdit && (
        <div className="mt-2 flex flex-wrap gap-1">
          <select
            value={dayIso}
            onChange={(e) => setDayIso(e.target.value)}
            className="rounded border border-[var(--border-hairline)] bg-[var(--surface-raised)] px-1.5 py-0.5 text-[11px]"
          >
            <option value="unscheduled">未排程</option>
            {dayKeys.map((k) => (
              <option key={k} value={k}>
                {dayLabel(k)}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            type="button"
            onClick={() =>
              onAdd(
                place,
                dayIso === "unscheduled" ? null : dayIso,
                inferredType
              )
            }
            className="h-7 px-2 text-[11px]"
          >
            加入行程
          </Button>
          {place.googleMapsUri && (
            <a
              href={place.googleMapsUri}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-7 items-center justify-center rounded-md border border-[var(--border-hairline)] px-2 text-[11px] hover:bg-[var(--surface-sunken)]/60"
            >
              ↗
            </a>
          )}
        </div>
      )}
    </li>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function inferItemTypeFromGoogleType(primary: string | null | undefined): string {
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

function countsFor(pins: MapPin[]): Record<string, number> {
  const c: Record<string, number> = {
    hotel: 0,
    restaurant: 0,
    activity: 0,
    transport: 0,
    confirmed: 0,
    pending: 0,
    shared: 0,
  };
  for (const p of pins) {
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

function RailTab({
  active,
  onClick,
  label,
  count,
  disabled,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count?: number;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
        active
          ? "bg-[var(--text-primary)] text-[var(--surface-raised)]"
          : disabled
            ? "text-[var(--text-faint)]"
            : "text-[var(--text-muted)] hover:bg-[var(--surface-sunken)]"
      )}
    >
      {label}
      {count != null && (
        <span className="ml-1 rounded-full bg-[var(--surface-sunken)] px-1 text-[9px] text-[var(--text-muted)]">
          {count}
        </span>
      )}
    </button>
  );
}

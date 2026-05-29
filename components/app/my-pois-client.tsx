"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { appFetchJson, AppApiFetchError } from "@/lib/app-client";
import { useAppLocale } from "@/components/app/app-locale-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { TabError, TabSkeleton } from "@/components/app/tab-shell";
import type { MapPin } from "@/components/app/trip-map-canvas";
import type { SavedPoi } from "@/lib/app-pois";
import type { SavedPoisResponse } from "@/app/api/app/pois/route";

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

const TYPE_GLYPH: Record<string, string> = {
  hotel: "🏨",
  restaurant: "🍽",
  activity: "🎯",
  transport: "🚌",
  other: "📌",
};

const COPY = {
  en: {
    title: "My Places",
    subtitle: "Places you saved from the map explorer.",
    empty: "No saved places yet.",
    emptyHint: "Open the Map and tap “Save” on any place to build your list.",
    all: "All",
    hotel: "Stays",
    restaurant: "Food",
    activity: "Activities",
    transport: "Transit",
    notesPlaceholder: "Add a note…",
    edit: "Edit",
    save: "Save",
    cancel: "Cancel",
    remove: "Remove",
    confirmRemove: "Remove this place from your list?",
    openMaps: "Google Maps",
    saved: "saved",
    loadError: "Failed to load your places.",
  },
  "zh-TW": {
    title: "我的地點",
    subtitle: "你從地圖探索器儲存的地點。",
    empty: "尚未儲存任何地點。",
    emptyHint: "開啟「地圖」，在任一地點按「儲存」即可建立清單。",
    all: "全部",
    hotel: "住宿",
    restaurant: "餐飲",
    activity: "活動",
    transport: "交通",
    notesPlaceholder: "新增備註…",
    edit: "編輯",
    save: "儲存",
    cancel: "取消",
    remove: "移除",
    confirmRemove: "確定要從清單移除這個地點嗎？",
    openMaps: "Google 地圖",
    saved: "個地點",
    loadError: "讀取地點失敗。",
  },
} as const;

type TypeFilter = "all" | "hotel" | "restaurant" | "activity" | "transport";

export function MyPoisClient() {
  const { locale } = useAppLocale();
  const copy = COPY[locale];

  const [pois, setPois] = useState<SavedPoi[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftNotes, setDraftNotes] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await appFetchJson<SavedPoisResponse>("/api/app/pois");
      setError(null);
      setPois(res.pois);
    } catch (err) {
      setError(
        err instanceof AppApiFetchError ? err.message : copy.loadError
      );
    }
  }, [copy.loadError]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    if (!pois) return [];
    if (typeFilter === "all") return pois;
    return pois.filter((p) => p.itemType === typeFilter);
  }, [pois, typeFilter]);

  const pins = useMemo<MapPin[]>(
    () =>
      filtered.map((p) => ({
        id: p.id,
        lat: p.lat,
        lng: p.lng,
        title: p.name,
        subtitle: p.address,
        itemType: p.itemType,
        stage: "explore",
        kind: "poi",
        itemId: null,
        optionId: null,
        dayKey: null,
        bookingUrl: p.googleMapsUrl,
      })),
    [filtered]
  );

  const fauxDestination = useMemo(() => {
    const first = filtered[0];
    return first
      ? { name: null, lat: first.lat, lng: first.lng }
      : { name: null, lat: null, lng: null };
  }, [filtered]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {
      hotel: 0,
      restaurant: 0,
      activity: 0,
      transport: 0,
    };
    for (const p of pois ?? []) {
      if (p.itemType in c) c[p.itemType]++;
    }
    return c;
  }, [pois]);

  const handleDelete = useCallback(
    async (id: string) => {
      if (!window.confirm(copy.confirmRemove)) return;
      setBusyId(id);
      try {
        await appFetchJson(`/api/app/pois/${id}`, { method: "DELETE" });
        setPois((prev) => (prev ? prev.filter((p) => p.id !== id) : prev));
        if (selectedId === id) setSelectedId(null);
      } catch (err) {
        setError(
          err instanceof AppApiFetchError ? err.message : copy.loadError
        );
      } finally {
        setBusyId(null);
      }
    },
    [copy.confirmRemove, copy.loadError, selectedId]
  );

  const handleSaveNotes = useCallback(
    async (id: string) => {
      setBusyId(id);
      try {
        const res = await appFetchJson<{ poi: SavedPoi }>(
          `/api/app/pois/${id}`,
          {
            method: "PATCH",
            body: JSON.stringify({ notes: draftNotes.trim() || null }),
          }
        );
        setPois((prev) =>
          prev ? prev.map((p) => (p.id === id ? res.poi : p)) : prev
        );
        setEditingId(null);
      } catch (err) {
        setError(
          err instanceof AppApiFetchError ? err.message : copy.loadError
        );
      } finally {
        setBusyId(null);
      }
    },
    [draftNotes, copy.loadError]
  );

  if (error && !pois) {
    return <TabError message={error} onRetry={() => void load()} />;
  }
  if (!pois) {
    return <TabSkeleton className="h-[calc(100vh-12rem)]" />;
  }

  return (
    <div className="flex h-full flex-col gap-3 p-2">
      <header className="flex flex-wrap items-center gap-2">
        <div>
          <h1 className="text-lg font-semibold text-[var(--text-primary)]">
            📍 {copy.title}
          </h1>
          <p className="text-xs text-[var(--text-muted)]">{copy.subtitle}</p>
        </div>
        <span className="text-mono ml-auto text-[11px] text-[var(--text-muted)]">
          {pois.length} {copy.saved}
        </span>
      </header>

      {/* Type filter */}
      <div className="flex flex-wrap gap-1">
        <Chip
          active={typeFilter === "all"}
          onClick={() => setTypeFilter("all")}
          label={copy.all}
          count={pois.length}
        />
        {(["hotel", "restaurant", "activity", "transport"] as const).map((t) => (
          <Chip
            key={t}
            active={typeFilter === t}
            onClick={() => setTypeFilter(t)}
            label={`${TYPE_GLYPH[t]} ${copy[t]}`}
            count={counts[t] ?? 0}
          />
        ))}
      </div>

      {pois.length === 0 ? (
        <section className="surface-tile flex flex-1 flex-col items-center justify-center gap-1 border-dashed p-10 text-center">
          <p className="text-sm text-[var(--text-muted)]">{copy.empty}</p>
          <p className="text-xs text-[var(--text-faint)]">{copy.emptyHint}</p>
        </section>
      ) : (
        <div className="grid min-h-0 flex-1 gap-2 lg:grid-cols-12">
          {/* List */}
          <section className="surface-tile min-h-[280px] overflow-y-auto lg:col-span-5">
            <ul className="divide-y divide-[var(--border-hairline)]">
              {filtered.map((p) => {
                const editing = editingId === p.id;
                return (
                  <li
                    key={p.id}
                    className={cn(
                      "px-3 py-2.5 transition-colors",
                      selectedId === p.id && "bg-[var(--accent-line-soft)]"
                    )}
                  >
                    <div className="flex items-start gap-2">
                      <button
                        type="button"
                        onClick={() => setSelectedId(p.id)}
                        className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-sunken)] text-base"
                        aria-label={p.name}
                      >
                        {TYPE_GLYPH[p.itemType] ?? "📌"}
                      </button>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <button
                            type="button"
                            onClick={() => setSelectedId(p.id)}
                            className="truncate text-left text-sm font-medium"
                          >
                            {p.name}
                          </button>
                          {p.source && (
                            <Badge
                              variant="secondary"
                              className="shrink-0 text-[9px]"
                            >
                              {p.source === "curated"
                                ? "策展"
                                : p.source === "google"
                                  ? "Google"
                                  : p.source}
                            </Badge>
                          )}
                        </div>
                        {p.address && (
                          <p className="truncate text-[11px] text-[var(--text-muted)]">
                            📍 {p.address}
                          </p>
                        )}
                        {p.destinationName && (
                          <p className="truncate text-[10px] text-[var(--text-faint)]">
                            🧭 {p.destinationName}
                          </p>
                        )}

                        {/* Notes */}
                        {editing ? (
                          <div className="mt-1.5 space-y-1.5">
                            <textarea
                              value={draftNotes}
                              onChange={(e) => setDraftNotes(e.target.value)}
                              placeholder={copy.notesPlaceholder}
                              rows={2}
                              className="w-full resize-none rounded-md border border-[var(--border-hairline)] bg-[var(--surface-raised)] px-2 py-1 text-xs"
                            />
                            <div className="flex gap-1">
                              <Button
                                size="sm"
                                type="button"
                                className="h-7 px-2 text-[11px]"
                                disabled={busyId === p.id}
                                onClick={() => void handleSaveNotes(p.id)}
                              >
                                {copy.save}
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                type="button"
                                className="h-7 px-2 text-[11px]"
                                onClick={() => setEditingId(null)}
                              >
                                {copy.cancel}
                              </Button>
                            </div>
                          </div>
                        ) : (
                          p.notes && (
                            <p className="mt-1 rounded-md bg-[var(--surface-sunken)]/60 px-2 py-1 text-[11px] text-[var(--text-secondary)]">
                              📝 {p.notes}
                            </p>
                          )
                        )}

                        {/* Actions */}
                        {!editing && (
                          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px]">
                            <button
                              type="button"
                              onClick={() => {
                                setEditingId(p.id);
                                setDraftNotes(p.notes ?? "");
                              }}
                              className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                            >
                              {copy.edit}
                            </button>
                            <a
                              href={
                                p.googleMapsUrl ??
                                `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`
                              }
                              target="_blank"
                              rel="noreferrer"
                              className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                            >
                              {copy.openMaps} ↗
                            </a>
                            <button
                              type="button"
                              disabled={busyId === p.id}
                              onClick={() => void handleDelete(p.id)}
                              className="text-red-500 hover:text-red-600 disabled:opacity-50"
                            >
                              {copy.remove}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>

          {/* Map */}
          <div className="surface-tile relative min-h-[280px] overflow-hidden lg:col-span-7">
            <TripMapCanvas
              destination={fauxDestination}
              pins={pins}
              dayRoutes={[]}
              selectedPinId={selectedId}
              onPinSelect={(pin) => setSelectedId(pin.id)}
            />
          </div>
        </div>
      )}

      {error && pois && (
        <div className="surface-tile shrink-0 border border-red-500/40 p-2 text-xs text-red-500">
          {error}
        </div>
      )}
    </div>
  );
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

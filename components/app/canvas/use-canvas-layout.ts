"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { appFetch, appFetchJson } from "@/lib/app-client";
import type {
  CanvasLayout,
  CanvasTileLayout,
  CanvasViewport,
} from "@/app/api/app/trips/[tripId]/canvas-layout/route";

export type TileSize = "sm" | "md" | "lg" | "xl";

/** World-space pixel dimensions for each seed size. Tiles are freely resizable
 * after placement — these only decide where a tile first lands. */
const SIZE_DIMS: Record<TileSize, { w: number; h: number }> = {
  sm: { w: 320, h: 300 },
  md: { w: 400, h: 340 },
  lg: { w: 560, h: 400 },
  xl: { w: 760, h: 440 },
};

export const CANVAS_GAP = 24;
const WRAP_WIDTH = 1720; // world px before a seeded row wraps
export const MIN_TILE_W = 240;
export const MIN_TILE_H = 200;

export interface TileSeed {
  id: string;
  size: TileSize;
}

export interface CanvasTilePos {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export const DEFAULT_VIEWPORT: CanvasViewport = {
  zoom: 1,
  panX: CANVAS_GAP,
  panY: CANVAS_GAP,
};

/** Shelf-pack a set of tiles left-to-right, wrapping at WRAP_WIDTH. */
function autoLayout(seeds: TileSeed[], startY = 0): CanvasTilePos[] {
  const out: CanvasTilePos[] = [];
  let x = 0;
  let y = startY;
  let rowH = 0;
  for (const seed of seeds) {
    const { w, h } = SIZE_DIMS[seed.size];
    if (x > 0 && x + w > WRAP_WIDTH) {
      x = 0;
      y += rowH + CANVAS_GAP;
      rowH = 0;
    }
    out.push({ id: seed.id, x, y, w, h });
    x += w + CANVAS_GAP;
    rowH = Math.max(rowH, h);
  }
  return out;
}

/**
 * Merge a saved layout with the current tile roster. Tiles that have a saved
 * position keep it; brand-new tiles (features added since the layout was saved)
 * are auto-placed on a fresh shelf below everything else so nothing is ever
 * hidden. Tiles that no longer exist are dropped.
 */
function mergeLayout(seeds: TileSeed[], saved: CanvasTileLayout[]): CanvasTilePos[] {
  const savedById = new Map(saved.map((t) => [t.id, t]));
  const positioned: CanvasTilePos[] = [];
  const missing: TileSeed[] = [];

  for (const seed of seeds) {
    const s = savedById.get(seed.id);
    if (s) positioned.push({ id: seed.id, x: s.x, y: s.y, w: s.w, h: s.h });
    else missing.push(seed);
  }

  if (missing.length > 0) {
    const maxY = positioned.reduce((m, p) => Math.max(m, p.y + p.h), 0);
    const startY = positioned.length > 0 ? maxY + CANVAS_GAP : 0;
    positioned.push(...autoLayout(missing, startY));
  }

  return positioned;
}

/**
 * Canvas layout state + server persistence. Loads the caller's board, keeps
 * tile positions/sizes and the viewport in local state, and debounces a PUT
 * back to the server on every change (per-user, per-trip). New tiles are
 * auto-placed; `reset` restores the seeded auto-layout.
 */
function seedKeyOf(seeds: TileSeed[]): string {
  return seeds.map((s) => s.id).join("|");
}

export function useCanvasLayout(tripId: string, seeds: TileSeed[]) {
  const [tiles, setTiles] = useState<CanvasTilePos[]>(() => autoLayout(seeds));
  const [viewport, setViewportState] = useState<CanvasViewport>(DEFAULT_VIEWPORT);

  // Roster sync via the "adjust state during render" pattern: when the tile set
  // changes (e.g. a custom grid is added), fold the newcomers into the current
  // board without clobbering saved positions — no effect, no cascading render.
  const [seedKey, setSeedKey] = useState(() => seedKeyOf(seeds));
  const nextSeedKey = seedKeyOf(seeds);
  if (nextSeedKey !== seedKey) {
    setSeedKey(nextSeedKey);
    setTiles((prev) => mergeLayout(seeds, prev));
  }

  const loadedRef = useRef(false);
  const saveTimer = useRef<number | null>(null);
  // Mirror the latest committed state so the debounced saver and the load
  // effect can read current values without re-subscribing.
  const seedsRef = useRef(seeds);
  const tilesRef = useRef(tiles);
  const viewportRef = useRef(viewport);
  useEffect(() => {
    seedsRef.current = seeds;
  }, [seeds]);
  useEffect(() => {
    tilesRef.current = tiles;
  }, [tiles]);
  useEffect(() => {
    viewportRef.current = viewport;
  }, [viewport]);

  const scheduleSave = useCallback(() => {
    if (!loadedRef.current) return;
    if (saveTimer.current != null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      // Read the freshest committed state at flush time.
      void appFetch(`/api/app/trips/${tripId}/canvas-layout`, {
        method: "PUT",
        body: JSON.stringify({ tiles: tilesRef.current, viewport: viewportRef.current }),
      }).catch(() => {
        // Best-effort — the next change will retry.
      });
    }, 600);
  }, [tripId]);

  // Load the saved board once per trip. Falls back to the seeded auto-layout.
  useEffect(() => {
    let cancelled = false;
    loadedRef.current = false;
    void (async () => {
      let saved: CanvasLayout = { tiles: [], viewport: null };
      try {
        const res = await appFetchJson<{ layout: CanvasLayout }>(
          `/api/app/trips/${tripId}/canvas-layout`,
        );
        saved = res.layout;
      } catch {
        // Non-critical: start from the seeded layout.
      }
      if (cancelled) return;
      setTiles(mergeLayout(seedsRef.current, saved.tiles));
      setViewportState(saved.viewport ?? DEFAULT_VIEWPORT);
      loadedRef.current = true;
    })();
    return () => {
      cancelled = true;
    };
  }, [tripId]);

  useEffect(() => {
    return () => {
      if (saveTimer.current != null) window.clearTimeout(saveTimer.current);
    };
  }, []);

  const moveTile = useCallback(
    (id: string, x: number, y: number) => {
      setTiles((prev) => {
        // Bring the moved tile to the front (end of array = top of stack).
        const idx = prev.findIndex((t) => t.id === id);
        if (idx < 0) return prev;
        const next = prev.slice();
        const [moved] = next.splice(idx, 1);
        next.push({ ...moved!, x, y });
        return next;
      });
      scheduleSave();
    },
    [scheduleSave],
  );

  const resizeTile = useCallback(
    (id: string, w: number, h: number) => {
      setTiles((prev) =>
        prev.map((t) =>
          t.id === id
            ? { ...t, w: Math.max(MIN_TILE_W, w), h: Math.max(MIN_TILE_H, h) }
            : t,
        ),
      );
      scheduleSave();
    },
    [scheduleSave],
  );

  const bringToFront = useCallback((id: string) => {
    setTiles((prev) => {
      const idx = prev.findIndex((t) => t.id === id);
      if (idx < 0 || idx === prev.length - 1) return prev;
      const next = prev.slice();
      const [moved] = next.splice(idx, 1);
      next.push(moved!);
      return next; // z-order only; no need to persist
    });
  }, []);

  const setViewport = useCallback(
    (next: CanvasViewport) => {
      setViewportState(next);
      scheduleSave();
    },
    [scheduleSave],
  );

  const reset = useCallback(() => {
    setTiles(autoLayout(seedsRef.current));
    setViewportState(DEFAULT_VIEWPORT);
    scheduleSave();
  }, [scheduleSave]);

  return {
    tiles,
    viewport,
    moveTile,
    resizeTile,
    bringToFront,
    setViewport,
    reset,
  };
}

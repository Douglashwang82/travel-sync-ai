"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * FLIP reorder helper. Records the bounding rect of every tile, then on the
 * next frame applies an inverted transform and animates it back to zero —
 * the standard First-Last-Invert-Play technique. Skipped under
 * prefers-reduced-motion. Returns void; the page's existing state update
 * causes the layout reflow that FLIP measures against.
 */
function runFlipReorder() {
  if (typeof window === "undefined") return;
  if (typeof document === "undefined") return;
  const reduce =
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) return;

  const cells = Array.from(
    document.querySelectorAll<HTMLElement>(".bento-cell"),
  );
  if (cells.length === 0) return;

  type Pair = { el: HTMLElement; first: DOMRect };
  const pairs: Pair[] = cells.map((el) => ({ el, first: el.getBoundingClientRect() }));

  // Two RAFs: first lets React commit the reordered DOM; second lets the
  // browser paint the FIRST positions before we invert.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      for (const { el, first } of pairs) {
        const last = el.getBoundingClientRect();
        const dx = first.left - last.left;
        const dy = first.top - last.top;
        if (dx === 0 && dy === 0) continue;
        el.style.setProperty("--bento-flip-x", `${dx}px`);
        el.style.setProperty("--bento-flip-y", `${dy}px`);
        el.dataset.flip = "true";
      }
      requestAnimationFrame(() => {
        for (const { el } of pairs) {
          if (el.dataset.flip !== "true") continue;
          el.dataset.flip = "play";
          el.style.setProperty("--bento-flip-x", "0px");
          el.style.setProperty("--bento-flip-y", "0px");
          const clear = () => {
            delete el.dataset.flip;
            el.style.removeProperty("--bento-flip-x");
            el.style.removeProperty("--bento-flip-y");
            el.removeEventListener("transitionend", clear);
          };
          el.addEventListener("transitionend", clear);
        }
      });
    });
  });
}

export type TileSize = "sm" | "md" | "lg" | "xl";

export interface LayoutEntry {
  id: string;
  size: TileSize;
}

export interface BentoLayout {
  order: LayoutEntry[];
}

const STORAGE_PREFIX = "bento-layout:";

function storageKey(tripId: string) {
  return `${STORAGE_PREFIX}${tripId}`;
}

function readLayout(tripId: string): BentoLayout | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKey(tripId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as BentoLayout;
    if (!parsed || !Array.isArray(parsed.order)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeLayout(tripId: string, layout: BentoLayout) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(tripId), JSON.stringify(layout));
  } catch {
    // Ignore — localStorage may be unavailable (private mode, etc.).
  }
}

/**
 * Bento layout state + persistence. Merges a stored layout with the default
 * so that newly-introduced tiles still appear (appended at the end), and
 * tiles that no longer exist are dropped silently.
 */
export function useBentoLayout(tripId: string, defaults: LayoutEntry[]) {
  const merge = useCallback(
    (stored: BentoLayout | null): LayoutEntry[] => {
      if (!stored) return defaults;
      const defaultMap = new Map(defaults.map((d) => [d.id, d]));
      const seen = new Set<string>();
      const merged: LayoutEntry[] = [];
      for (const entry of stored.order) {
        const def = defaultMap.get(entry.id);
        if (!def) continue;
        merged.push({ id: entry.id, size: entry.size ?? def.size });
        seen.add(entry.id);
      }
      for (const d of defaults) {
        if (!seen.has(d.id)) merged.push(d);
      }
      return merged;
    },
    [defaults]
  );

  const [order, setOrder] = useState<LayoutEntry[]>(defaults);

  useEffect(() => {
    setOrder(merge(readLayout(tripId)));
  }, [tripId, merge]);

  const persist = useCallback(
    (next: LayoutEntry[]) => {
      setOrder(next);
      writeLayout(tripId, { order: next });
    },
    [tripId]
  );

  const move = useCallback(
    (fromId: string, toId: string) => {
      if (fromId === toId) return;
      runFlipReorder();
      setOrder((prev) => {
        const fromIdx = prev.findIndex((e) => e.id === fromId);
        const toIdx = prev.findIndex((e) => e.id === toId);
        if (fromIdx < 0 || toIdx < 0) return prev;
        const next = prev.slice();
        const [moved] = next.splice(fromIdx, 1);
        next.splice(toIdx, 0, moved!);
        writeLayout(tripId, { order: next });
        return next;
      });
    },
    [tripId]
  );

  const setSize = useCallback(
    (id: string, size: TileSize) => {
      setOrder((prev) => {
        const next = prev.map((e) => (e.id === id ? { ...e, size } : e));
        writeLayout(tripId, { order: next });
        return next;
      });
    },
    [tripId]
  );

  const reset = useCallback(() => {
    persist(defaults);
  }, [defaults, persist]);

  return { order, move, setSize, reset };
}

export const SIZE_ORDER: TileSize[] = ["sm", "md", "lg", "xl"];

export function nextSize(size: TileSize): TileSize {
  const idx = SIZE_ORDER.indexOf(size);
  return SIZE_ORDER[(idx + 1) % SIZE_ORDER.length]!;
}

"use client";

import {
  useCallback,
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import type { CanvasViewport } from "@/app/api/app/trips/[tripId]/canvas-layout/route";
import { CANVAS_GAP } from "@/components/app/canvas/use-canvas-layout";

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 2;
const ZOOM_STEP = 1.2;

export interface CanvasBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function clampZoom(z: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

/**
 * Pan & zoom surface for the trip canvas. A fixed-height, overflow-hidden
 * viewport containing a `.canvas-world` layer that is translated + scaled.
 * Background drag pans; wheel zooms toward the cursor; the toolbar exposes
 * zoom in/out, Fit (frame all tiles), and Reset layout.
 *
 * Controlled: the parent owns `viewport` (persisted per-user) and receives
 * every change through `onViewportChange`.
 */
export function TripCanvas({
  viewport,
  onViewportChange,
  bounds,
  onResetLayout,
  toolbarExtra,
  children,
}: {
  viewport: CanvasViewport;
  onViewportChange: (v: CanvasViewport) => void;
  bounds: CanvasBounds | null;
  onResetLayout?: () => void;
  toolbarExtra?: ReactNode;
  children: ReactNode;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const pan = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);
  // Mirror the latest viewport into a ref so stable pointer/wheel handlers can
  // read fresh pan/zoom without being recreated on every change.
  const vpRef = useRef(viewport);
  useEffect(() => {
    vpRef.current = viewport;
  }, [viewport]);

  const zoomAround = useCallback(
    (nextZoomRaw: number, cx: number, cy: number) => {
      const v = vpRef.current;
      const nextZoom = clampZoom(nextZoomRaw);
      if (nextZoom === v.zoom) return;
      // Keep the world point under (cx, cy) fixed while scaling.
      const worldX = (cx - v.panX) / v.zoom;
      const worldY = (cy - v.panY) / v.zoom;
      onViewportChange({
        zoom: nextZoom,
        panX: cx - worldX * nextZoom,
        panY: cy - worldY * nextZoom,
      });
    },
    [onViewportChange],
  );

  const zoomButton = useCallback(
    (factor: number) => {
      const el = viewportRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      zoomAround(vpRef.current.zoom * factor, rect.width / 2, rect.height / 2);
    },
    [zoomAround],
  );

  const resetZoom = useCallback(() => {
    const el = viewportRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    zoomAround(1, rect.width / 2, rect.height / 2);
  }, [zoomAround]);

  const fit = useCallback(() => {
    const el = viewportRef.current;
    if (!el || !bounds) return;
    const rect = el.getBoundingClientRect();
    const contentW = Math.max(1, bounds.maxX - bounds.minX);
    const contentH = Math.max(1, bounds.maxY - bounds.minY);
    const margin = CANVAS_GAP * 2;
    const zoom = clampZoom(
      Math.min((rect.width - margin) / contentW, (rect.height - margin) / contentH),
    );
    // Center the content bounding box in the viewport.
    const panX = (rect.width - contentW * zoom) / 2 - bounds.minX * zoom;
    const panY = (rect.height - contentH * zoom) / 2 - bounds.minY * zoom;
    onViewportChange({ zoom, panX, panY });
  }, [bounds, onViewportChange]);

  // Wheel: ctrl/⌘ or trackpad pinch zooms; otherwise scroll pans the board.
  // Bound as a non-passive native listener so preventDefault actually sticks.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const rect = el!.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      if (e.ctrlKey || e.metaKey) {
        const factor = Math.exp(-e.deltaY / 240);
        zoomAround(vpRef.current.zoom * factor, cx, cy);
      } else {
        const v = vpRef.current;
        onViewportChange({ zoom: v.zoom, panX: v.panX - e.deltaX, panY: v.panY - e.deltaY });
      }
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAround, onViewportChange]);

  const onPointerDown = useCallback((e: ReactPointerEvent) => {
    // Only pan when the gesture starts on empty canvas, not on a tile.
    if ((e.target as HTMLElement).closest("[data-canvas-tile]")) return;
    if (e.button !== 0) return;
    const v = vpRef.current;
    pan.current = { startX: e.clientX, startY: e.clientY, panX: v.panX, panY: v.panY };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback(
    (e: ReactPointerEvent) => {
      const p = pan.current;
      if (!p) return;
      onViewportChange({
        zoom: vpRef.current.zoom,
        panX: p.panX + (e.clientX - p.startX),
        panY: p.panY + (e.clientY - p.startY),
      });
    },
    [onViewportChange],
  );

  const endPan = useCallback((e: ReactPointerEvent) => {
    if (!pan.current) return;
    pan.current = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // Already released.
    }
  }, []);

  const pct = Math.round(viewport.zoom * 100);

  return (
    <div className="relative">
      <div
        ref={viewportRef}
        id="trip-canvas-viewport"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPan}
        onPointerCancel={endPan}
        className="canvas-viewport relative h-[76vh] min-h-[520px] w-full touch-none overflow-hidden rounded-[var(--radius-tile)] border border-[var(--border-hairline)] bg-[var(--surface-sunken)]"
      >
        {/* Dot grid that pans & scales with the board for spatial grounding. */}
        <div
          aria-hidden
          className="canvas-grid pointer-events-none absolute inset-0"
          style={{
            backgroundPosition: `${viewport.panX}px ${viewport.panY}px`,
            backgroundSize: `${24 * viewport.zoom}px ${24 * viewport.zoom}px`,
          }}
        />
        <div
          id="trip-canvas-world"
          className="canvas-world absolute left-0 top-0"
          style={{
            transform: `translate(${viewport.panX}px, ${viewport.panY}px) scale(${viewport.zoom})`,
            transformOrigin: "0 0",
          }}
        >
          {children}
        </div>
      </div>

      <div
        id="trip-canvas-toolbar"
        className="pointer-events-none absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border border-[var(--border-hairline)] bg-[var(--surface-base)]/90 p-1 shadow-sm backdrop-blur"
      >
        <ToolbarButton id="canvas-zoom-out" label="Zoom out" onClick={() => zoomButton(1 / ZOOM_STEP)}>
          −
        </ToolbarButton>
        <button
          type="button"
          id="canvas-zoom-reset"
          onClick={resetZoom}
          className="pointer-events-auto min-w-[52px] rounded-full px-2 py-1 text-[11px] font-semibold tabular-nums text-[var(--text-secondary)] hover:bg-[var(--surface-sunken)]"
          title="Reset zoom to 100%"
        >
          {pct}%
        </button>
        <ToolbarButton id="canvas-zoom-in" label="Zoom in" onClick={() => zoomButton(ZOOM_STEP)}>
          +
        </ToolbarButton>
        <span aria-hidden className="mx-0.5 h-4 w-px bg-[var(--border-hairline)]" />
        <ToolbarButton id="canvas-fit" label="Fit all tiles" onClick={fit} wide>
          Fit
        </ToolbarButton>
        {onResetLayout && (
          <ToolbarButton id="canvas-reset-layout" label="Reset layout" onClick={onResetLayout} wide>
            Reset
          </ToolbarButton>
        )}
        {toolbarExtra}
      </div>

      <CanvasStyles />
    </div>
  );
}

/**
 * Canvas-only overrides. The tiles reuse `.bento-frame` for the frosted
 * surface, but that class transitions `transform` (for the grid's hover-lift)
 * — on a free canvas that makes dragging feel laggy, and the hover `translateY`
 * would fight the positioning transform. Here we drop the transform transition
 * and hover-lift, and paint the dot grid.
 */
function CanvasStyles() {
  return (
    <style>{`
      .canvas-grid {
        background-image: radial-gradient(
          circle,
          color-mix(in oklab, var(--text-faint) 45%, transparent) 1px,
          transparent 1px
        );
      }
      .canvas-tile {
        transition:
          box-shadow var(--duration-confirm) var(--ease-confirm),
          border-color var(--duration-confirm) var(--ease-confirm);
        will-change: transform;
      }
      .canvas-tile-active {
        z-index: 5;
        box-shadow: var(--shadow-raise), var(--accent-line-glow),
          inset 0 1px 0 rgb(255 255 255 / 0.5);
      }
    `}</style>
  );
}

function ToolbarButton({
  id,
  label,
  onClick,
  children,
  wide,
}: {
  id: string;
  label: string;
  onClick: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <button
      type="button"
      id={id}
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`pointer-events-auto inline-flex h-7 items-center justify-center rounded-full text-[11px] font-semibold text-[var(--text-secondary)] hover:bg-[var(--surface-sunken)] hover:text-[var(--text-primary)] ${
        wide ? "px-3 uppercase tracking-wide" : "w-7 text-base"
      }`}
    >
      {children}
    </button>
  );
}

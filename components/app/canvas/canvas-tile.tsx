"use client";

import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  MIN_TILE_H,
  MIN_TILE_W,
  type CanvasTilePos,
} from "@/components/app/canvas/use-canvas-layout";

/**
 * A single free-floating tile on the trip canvas. Absolutely positioned in
 * world space; the parent `.canvas-world` applies the pan/zoom transform.
 *
 * Owns its own drag (header handle) and resize (bottom-right handle) gestures
 * via pointer events. Screen deltas are divided by `zoom` so a tile tracks the
 * cursor 1:1 regardless of how far the board is zoomed out. Positions are held
 * locally mid-gesture for smoothness and committed to the layout on release.
 */
export function CanvasTile({
  pos,
  zoom,
  title,
  icon,
  href,
  children,
  embed = true,
  onMove,
  onResize,
  onFocus,
}: {
  pos: CanvasTilePos;
  zoom: number;
  title: string;
  icon?: ReactNode;
  href?: string;
  children: ReactNode;
  embed?: boolean;
  onMove: (id: string, x: number, y: number) => void;
  onResize: (id: string, w: number, h: number) => void;
  onFocus: (id: string) => void;
}) {
  const [draft, setDraft] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const gesture = useRef<{
    kind: "move" | "resize";
    startX: number;
    startY: number;
    origin: CanvasTilePos;
  } | null>(null);

  const x = draft?.x ?? pos.x;
  const y = draft?.y ?? pos.y;
  const w = draft?.w ?? pos.w;
  const h = draft?.h ?? pos.h;

  const beginMove = useCallback(
    (e: ReactPointerEvent) => {
      // Ignore drags that start on the "Open" link.
      if ((e.target as HTMLElement).closest("a")) return;
      e.preventDefault();
      e.stopPropagation();
      onFocus(pos.id);
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      gesture.current = { kind: "move", startX: e.clientX, startY: e.clientY, origin: pos };
      setDraft({ x: pos.x, y: pos.y, w: pos.w, h: pos.h });
    },
    [onFocus, pos],
  );

  const beginResize = useCallback(
    (e: ReactPointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      onFocus(pos.id);
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      gesture.current = { kind: "resize", startX: e.clientX, startY: e.clientY, origin: pos };
      setDraft({ x: pos.x, y: pos.y, w: pos.w, h: pos.h });
    },
    [onFocus, pos],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent) => {
      const g = gesture.current;
      if (!g) return;
      const dx = (e.clientX - g.startX) / zoom;
      const dy = (e.clientY - g.startY) / zoom;
      if (g.kind === "move") {
        setDraft({ x: g.origin.x + dx, y: g.origin.y + dy, w: g.origin.w, h: g.origin.h });
      } else {
        setDraft({
          x: g.origin.x,
          y: g.origin.y,
          w: Math.max(MIN_TILE_W, g.origin.w + dx),
          h: Math.max(MIN_TILE_H, g.origin.h + dy),
        });
      }
    },
    [zoom],
  );

  const endGesture = useCallback(
    (e: ReactPointerEvent) => {
      const g = gesture.current;
      if (!g) return;
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // Pointer may already be released.
      }
      const d = draft;
      gesture.current = null;
      setDraft(null);
      if (!d) return;
      if (g.kind === "move") onMove(pos.id, d.x, d.y);
      else onResize(pos.id, d.w, d.h);
    },
    [draft, onMove, onResize, pos.id],
  );

  return (
    <section
      id={`canvas-tile-${pos.id}`}
      data-canvas-tile={pos.id}
      className={cn(
        "canvas-tile bento-frame absolute flex flex-col overflow-hidden rounded-[var(--radius-tile)] border",
        draft ? "canvas-tile-active" : undefined,
      )}
      style={{ left: 0, top: 0, width: w, height: h, transform: `translate(${x}px, ${y}px)` }}
      onPointerDown={() => onFocus(pos.id)}
    >
      <header
        id={`canvas-tile-header-${pos.id}`}
        onPointerDown={beginMove}
        onPointerMove={onPointerMove}
        onPointerUp={endGesture}
        onPointerCancel={endGesture}
        className="flex cursor-grab items-center justify-between gap-2 border-b border-[var(--surface-glass-edge)] bg-[var(--surface-base)]/25 px-4 py-2 active:cursor-grabbing"
      >
        <h3 className="flex min-w-0 items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
          {icon && (
            <span aria-hidden className="text-[var(--accent-line)]">
              {icon}
            </span>
          )}
          <span className="truncate">{title}</span>
        </h3>
        {href && (
          <a
            id={`canvas-tile-open-${pos.id}`}
            href={href}
            className="shrink-0 text-[10px] uppercase tracking-wide text-[var(--text-faint)] hover:text-[var(--text-primary)]"
          >
            Open ↗
          </a>
        )}
      </header>

      <div
        className={cn(
          "flex-1 min-h-0 overflow-y-auto",
          embed ? "bento-embed p-4" : "p-0",
        )}
      >
        {children}
      </div>

      {/* Bottom-right resize handle. */}
      <button
        type="button"
        id={`canvas-tile-resize-${pos.id}`}
        aria-label={`Resize ${title}`}
        onPointerDown={beginResize}
        onPointerMove={onPointerMove}
        onPointerUp={endGesture}
        onPointerCancel={endGesture}
        className="absolute bottom-0 right-0 flex h-5 w-5 cursor-nwse-resize items-end justify-end p-1 text-[var(--text-faint)] hover:text-[var(--text-secondary)]"
        title="Drag to resize"
      >
        <ResizeGripIcon />
      </button>
    </section>
  );
}

function ResizeGripIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
      <path d="M9 1 1 9M9 5 5 9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

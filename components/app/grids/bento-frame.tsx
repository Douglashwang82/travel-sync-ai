"use client";

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { nextSize, type TileSize } from "@/components/app/grids/use-bento-layout";

/**
 * Uniform outer shell for every bento tile. Owns:
 *  - the shared surface (background, border, radius, shadow)
 *  - the floating header strip (title + drag handle + size cycle)
 *  - drag-and-drop reorder via native HTML5 DnD
 *  - anchor `id` for scroll-spy and `data-bento-tile` for j/k keyboard nav
 *
 * Embedded feature components keep their own internal headers; the
 * `.bento-embed` class on the content wrapper neutralizes redundant
 * `surface-tile` chrome on the direct children so they blend with the frame.
 */
export function BentoFrame({
  id,
  title,
  icon,
  size,
  onMove,
  onResize,
  href,
  children,
  className,
  embed = true,
}: {
  id: string;
  title: string;
  icon?: ReactNode;
  size: TileSize;
  onMove: (fromId: string, toId: string) => void;
  onResize: (id: string, size: TileSize) => void;
  href?: string;
  children: ReactNode;
  className?: string;
  embed?: boolean;
}) {
  const [dragOver, setDragOver] = useState(false);

  return (
    <section
      id={id}
      tabIndex={-1}
      data-bento-tile
      data-tile-size={size}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("application/x-bento-tile")) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        const fromId = e.dataTransfer.getData("application/x-bento-tile");
        setDragOver(false);
        if (fromId && fromId !== id) {
          e.preventDefault();
          onMove(fromId, id);
        }
      }}
      className={cn(
        "bento-frame group/frame relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-[var(--radius-tile)]",
        "border border-[var(--border-hairline)] bg-[var(--surface-raised)] shadow-[var(--shadow-flat)]",
        "scroll-mt-24 transition-[box-shadow,border-color] duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-line)] focus-visible:ring-offset-2",
        dragOver && "ring-2 ring-[var(--accent-line)] ring-offset-2",
        className
      )}
    >
      <header className="flex items-center justify-between gap-2 border-b border-[var(--border-hairline)] bg-[var(--surface-base)]/40 px-4 py-2 backdrop-blur-sm">
        <div className="flex min-w-0 items-center gap-2">
          {/* Drag handle — the only element on which `draggable` is set. */}
          <button
            type="button"
            aria-label={`Reorder ${title}`}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("application/x-bento-tile", id);
              const tile = (e.currentTarget as HTMLElement).closest(
                ".bento-frame"
              ) as HTMLElement | null;
              if (tile) e.dataTransfer.setDragImage(tile, 20, 20);
            }}
            className="inline-flex h-6 w-6 cursor-grab items-center justify-center rounded-md text-[var(--text-faint)] hover:bg-[var(--surface-sunken)] hover:text-[var(--text-secondary)] active:cursor-grabbing"
            title="Drag to reorder"
          >
            <DragHandleIcon />
          </button>
          <h3 className="flex min-w-0 items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
            {icon && (
              <span aria-hidden className="text-[var(--accent-line)]">
                {icon}
              </span>
            )}
            <span className="truncate">{title}</span>
          </h3>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {href && (
            <a
              href={href}
              className="text-[10px] uppercase tracking-wide text-[var(--text-faint)] hover:text-[var(--text-primary)]"
            >
              Open ↗
            </a>
          )}
          <button
            type="button"
            aria-label={`Resize ${title} (current: ${size})`}
            onClick={() => onResize(id, nextSize(size))}
            className="inline-flex h-6 min-w-[28px] items-center justify-center rounded-md px-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)] hover:bg-[var(--surface-sunken)] hover:text-[var(--text-primary)]"
            title="Cycle tile size"
          >
            {size}
          </button>
        </div>
      </header>

      <div
        className={cn(
          "flex-1 min-h-0 overflow-y-auto",
          embed ? "bento-embed p-4" : "p-0"
        )}
      >
        {children}
      </div>
    </section>
  );
}

function DragHandleIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden
      className="text-current"
    >
      <circle cx="5" cy="3" r="1" fill="currentColor" />
      <circle cx="9" cy="3" r="1" fill="currentColor" />
      <circle cx="5" cy="7" r="1" fill="currentColor" />
      <circle cx="9" cy="7" r="1" fill="currentColor" />
      <circle cx="5" cy="11" r="1" fill="currentColor" />
      <circle cx="9" cy="11" r="1" fill="currentColor" />
    </svg>
  );
}

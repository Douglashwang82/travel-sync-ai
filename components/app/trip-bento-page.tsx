"use client";

import { useEffect, useMemo, useRef, type ComponentType, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { HeroGrid } from "@/components/app/grids/hero-grid";
import { ItineraryGrid } from "@/components/app/grids/itinerary-grid";
import { BudgetGrid } from "@/components/app/grids/budget-grid";
import { TaskGrid } from "@/components/app/grids/task-grid";
import { IdeasGrid } from "@/components/app/grids/ideas-grid";
import { VotesGrid } from "@/components/app/grids/votes-grid";
import { MapGrid } from "@/components/app/grids/map-grid";
import { PackGrid } from "@/components/app/grids/pack-grid";
import { MembersGrid } from "@/components/app/grids/members-grid";
import { BentoFrame } from "@/components/app/grids/bento-frame";
import {
  useBentoLayout,
  type LayoutEntry,
  type TileSize,
} from "@/components/app/grids/use-bento-layout";
import {
  CommandPalette,
  useCommandPalette,
} from "@/components/app/command-palette";

interface TileDef {
  id: string;
  title: string;
  icon: ReactNode;
  Component: ComponentType<{ tripId: string }>;
  defaultSize: TileSize;
  href?: (tripId: string) => string;
}

const TILES: TileDef[] = [
  { id: "hero", title: "Trip", icon: "✦", Component: HeroGrid, defaultSize: "xl" },
  { id: "itinerary", title: "Itinerary", icon: "📅", Component: ItineraryGrid, defaultSize: "lg", href: (t) => `/app/trips/${t}/itinerary` },
  { id: "budget", title: "Budget", icon: "💰", Component: BudgetGrid, defaultSize: "md", href: (t) => `/app/trips/${t}/expenses` },
  { id: "tasks", title: "Tasks", icon: "✓", Component: TaskGrid, defaultSize: "lg", href: (t) => `/app/trips/${t}/board` },
  { id: "ideas", title: "Ideas", icon: "✨", Component: IdeasGrid, defaultSize: "lg", href: (t) => `/app/trips/${t}/ideas` },
  { id: "votes", title: "Votes", icon: "🗳", Component: VotesGrid, defaultSize: "md", href: (t) => `/app/trips/${t}/votes` },
  { id: "map", title: "Map", icon: "📍", Component: MapGrid, defaultSize: "md", href: (t) => `/app/trips/${t}/map` },
  { id: "pack", title: "Pack", icon: "🧳", Component: PackGrid, defaultSize: "md", href: (t) => `/app/trips/${t}/pack` },
  { id: "members", title: "Members", icon: "👥", Component: MembersGrid, defaultSize: "md" },
];

const TILE_MAP = new Map(TILES.map((t) => [t.id, t]));

const DEFAULT_LAYOUT: LayoutEntry[] = TILES.map((t) => ({
  id: t.id,
  size: t.defaultSize,
}));

/**
 * Single-page bento grid workspace. Every feature is rendered through the
 * uniform `BentoFrame` shell — same background, same chrome, same drag
 * handle and size cycle button. Order and per-tile size persist to
 * localStorage via `useBentoLayout`.
 */
export function TripBentoPage({ tripId }: { tripId: string }) {
  const palette = useCommandPalette();
  const searchParams = useSearchParams();
  const tilesRef = useRef<HTMLDivElement>(null);
  const { order, move, setSize, reset } = useBentoLayout(tripId, DEFAULT_LAYOUT);

  const entries = useMemo(
    () =>
      order
        .map((entry) => {
          const def = TILE_MAP.get(entry.id);
          return def ? { entry, def } : null;
        })
        .filter((x): x is { entry: LayoutEntry; def: TileDef } => x !== null),
    [order]
  );

  // Scroll to ?scroll=<id> (used by sub-route redirects).
  useEffect(() => {
    const id = searchParams?.get("scroll");
    if (!id) return;
    const t = setTimeout(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
    return () => clearTimeout(t);
  }, [searchParams]);

  // j/k tile nav, ? to open command palette.
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const inField =
        !!target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);
      if (inField) return;

      if (e.key === "?") {
        e.preventDefault();
        palette.setOpen(true);
        return;
      }

      if (e.key !== "j" && e.key !== "k") return;
      const root = tilesRef.current;
      if (!root) return;
      const tiles = Array.from(
        root.querySelectorAll<HTMLElement>("[data-bento-tile]")
      );
      if (tiles.length === 0) return;
      const current = document.activeElement as HTMLElement | null;
      const idx = current
        ? tiles.findIndex((t) => t === current || t.contains(current))
        : -1;
      const dir = e.key === "j" ? 1 : -1;
      const next = Math.max(0, Math.min(tiles.length - 1, idx < 0 ? 0 : idx + dir));
      e.preventDefault();
      tiles[next]?.focus();
      tiles[next]?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [palette]);

  return (
    <>
      <CommandPalette
        tripId={tripId}
        open={palette.open}
        onOpenChange={palette.setOpen}
        onAddItem={() => {}}
      />

      <div className="mb-3 flex items-center justify-between gap-2 text-xs text-[var(--text-muted)]">
        <span className="text-caps">Workspace</span>
        <button
          type="button"
          onClick={reset}
          className="rounded-full border border-[var(--border-hairline)] px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
          title="Reset to default layout"
        >
          Reset layout
        </button>
      </div>

      <div ref={tilesRef} className="bento-grid">
        {entries.map(({ entry, def }) => {
          const Component = def.Component;
          return (
            <div
              key={entry.id}
              className={`bento-cell bento-size-${entry.size}`}
            >
              <BentoFrame
                id={entry.id}
                title={def.title}
                icon={def.icon}
                size={entry.size}
                onMove={move}
                onResize={setSize}
                href={def.href ? def.href(tripId) : undefined}
                embed={entry.id !== "members"}
              >
                <Component tripId={tripId} />
              </BentoFrame>
            </div>
          );
        })}
      </div>

      <BentoGridStyles />
    </>
  );
}

/**
 * Grid template + size classes. Mobile collapses everything to full width;
 * desktop honors per-tile `bento-size-*` spans set by `useBentoLayout`.
 */
function BentoGridStyles() {
  return (
    <style>{`
      .bento-grid {
        display: grid;
        grid-template-columns: repeat(12, minmax(0, 1fr));
        gap: 1rem;
        grid-auto-rows: minmax(280px, auto);
      }
      .bento-grid > * { min-width: 0; }
      .bento-cell { grid-column: span 12; }

      @media (min-width: 768px) {
        .bento-grid { gap: 1.25rem; }
        .bento-size-sm { grid-column: span 6; }
        .bento-size-md { grid-column: span 6; }
        .bento-size-lg { grid-column: span 12; }
        .bento-size-xl { grid-column: span 12; }
      }
      @media (min-width: 1024px) {
        .bento-size-sm { grid-column: span 3; }
        .bento-size-md { grid-column: span 4; }
        .bento-size-lg { grid-column: span 6; }
        .bento-size-xl { grid-column: span 12; }
      }
      @media (min-width: 1280px) {
        .bento-grid { gap: 1.5rem; }
      }
    `}</style>
  );
}

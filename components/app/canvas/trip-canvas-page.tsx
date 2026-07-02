"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import { HeroGrid } from "@/components/app/grids/hero-grid";
import { ItineraryGrid } from "@/components/app/grids/itinerary-grid";
import { CalendarGrid } from "@/components/app/grids/calendar-grid";
import { BudgetGrid } from "@/components/app/grids/budget-grid";
import { TaskGrid } from "@/components/app/grids/task-grid";
import { IdeasGrid } from "@/components/app/grids/ideas-grid";
import { PlanMasterGrid } from "@/components/app/grids/plan-master-grid";
import { VotesGrid } from "@/components/app/grids/votes-grid";
import { MapGrid } from "@/components/app/grids/map-grid";
import { PackGrid } from "@/components/app/grids/pack-grid";
import { MembersGrid } from "@/components/app/grids/members-grid";
import { SharedGrid } from "@/components/app/grids/shared-grid";
import { CustomGrid } from "@/components/app/grids/custom-grid";
import { AddCustomGridDialog } from "@/components/app/grids/add-custom-grid-dialog";
import { TripCanvas, type CanvasBounds } from "@/components/app/canvas/trip-canvas";
import { CanvasTile } from "@/components/app/canvas/canvas-tile";
import {
  useCanvasLayout,
  type TileSeed,
  type TileSize,
} from "@/components/app/canvas/use-canvas-layout";
import {
  CommandPalette,
  useCommandPalette,
} from "@/components/app/command-palette";
import { appFetchJson } from "@/lib/app-client";
import type { CustomGrid as CustomGridData } from "@/app/api/app/trips/[tripId]/custom-grids/route";

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
  { id: "plan-master", title: "Plan master", icon: "🧭", Component: PlanMasterGrid, defaultSize: "lg" },
  { id: "itinerary", title: "Itinerary", icon: "📅", Component: ItineraryGrid, defaultSize: "lg", href: (t) => `/app/trips/${t}/itinerary` },
  { id: "calendar", title: "Calendar", icon: "📆", Component: CalendarGrid, defaultSize: "lg" },
  { id: "budget", title: "Budget", icon: "💰", Component: BudgetGrid, defaultSize: "md", href: (t) => `/app/trips/${t}/expenses` },
  { id: "tasks", title: "Tasks", icon: "✓", Component: TaskGrid, defaultSize: "lg", href: (t) => `/app/trips/${t}/board` },
  { id: "ideas", title: "Ideas", icon: "✨", Component: IdeasGrid, defaultSize: "lg", href: (t) => `/app/trips/${t}/ideas` },
  { id: "shared", title: "Shared", icon: "🔗", Component: SharedGrid, defaultSize: "lg" },
  { id: "votes", title: "Votes", icon: "🗳", Component: VotesGrid, defaultSize: "md", href: (t) => `/app/trips/${t}/votes` },
  { id: "map", title: "Map", icon: "📍", Component: MapGrid, defaultSize: "md", href: (t) => `/app/trips/${t}/map` },
  { id: "pack", title: "Pack", icon: "🧳", Component: PackGrid, defaultSize: "md", href: (t) => `/app/trips/${t}/pack` },
  { id: "members", title: "Members", icon: "👥", Component: MembersGrid, defaultSize: "md" },
];

const CUSTOM_TILE_PREFIX = "custom:";
function customTileId(gridId: string): string {
  return `${CUSTOM_TILE_PREFIX}${gridId}`;
}
function isCustomTileId(id: string): boolean {
  return id.startsWith(CUSTOM_TILE_PREFIX);
}

/**
 * The trip overview: a free-form pan & zoom canvas. Every feature is a
 * free-floating tile (same feature clients as before, wrapped in `CanvasTile`
 * instead of a grid cell). Positions/sizes and the viewport persist per-user
 * via `useCanvasLayout`. Custom AI grids appear as tiles too.
 */
export function TripCanvasPage({ tripId }: { tripId: string }) {
  const palette = useCommandPalette();
  const [customGrids, setCustomGrids] = useState<CustomGridData[]>([]);
  const [addOpen, setAddOpen] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const res = await appFetchJson<{ grids: CustomGridData[] }>(
          `/api/app/trips/${tripId}/custom-grids`,
        );
        setCustomGrids(res.grids);
      } catch {
        // Non-critical: leave the list empty; the user can retry via Add dialog.
      }
    })();
  }, [tripId]);

  const allTiles = useMemo<TileDef[]>(() => {
    const customTiles: TileDef[] = customGrids.map((g) => ({
      id: customTileId(g.id),
      title: g.title,
      icon: "🤖",
      Component: () => null,
      defaultSize: "md",
    }));
    return [...TILES, ...customTiles];
  }, [customGrids]);

  const tileMap = useMemo(() => new Map(allTiles.map((t) => [t.id, t])), [allTiles]);

  const seeds = useMemo<TileSeed[]>(
    () => allTiles.map((t) => ({ id: t.id, size: t.defaultSize })),
    [allTiles],
  );

  const { tiles, viewport, moveTile, resizeTile, bringToFront, setViewport, reset } =
    useCanvasLayout(tripId, seeds);

  const customGridMap = useMemo(
    () => new Map(customGrids.map((g) => [customTileId(g.id), g])),
    [customGrids],
  );

  const handleCustomCreated = useCallback((grid: CustomGridData) => {
    setCustomGrids((prev) => [...prev, grid]);
  }, []);

  const handleCustomChange = useCallback((next: CustomGridData) => {
    setCustomGrids((prev) => prev.map((g) => (g.id === next.id ? next : g)));
  }, []);

  const handleCustomDelete = useCallback((id: string) => {
    setCustomGrids((prev) => prev.filter((g) => g.id !== id));
  }, []);

  const bounds = useMemo<CanvasBounds | null>(() => {
    if (tiles.length === 0) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const t of tiles) {
      minX = Math.min(minX, t.x);
      minY = Math.min(minY, t.y);
      maxX = Math.max(maxX, t.x + t.w);
      maxY = Math.max(maxY, t.y + t.h);
    }
    return { minX, minY, maxX, maxY };
  }, [tiles]);

  // `?` opens the command palette (matches the old bento shortcut).
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
      }
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

      <AddCustomGridDialog
        tripId={tripId}
        open={addOpen}
        onOpenChange={setAddOpen}
        onCreated={handleCustomCreated}
      />

      <TripCanvas
        viewport={viewport}
        onViewportChange={setViewport}
        bounds={bounds}
        onResetLayout={reset}
        toolbarExtra={
          <>
            <span aria-hidden className="mx-0.5 h-4 w-px bg-[var(--border-hairline)]" />
            <button
              type="button"
              id="canvas-add-grid"
              onClick={() => setAddOpen(true)}
              className="pointer-events-auto inline-flex h-7 items-center justify-center rounded-full px-3 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)] hover:bg-[var(--surface-sunken)] hover:text-[var(--text-primary)]"
              title="Add a custom AI-powered grid"
            >
              + Grid
            </button>
          </>
        }
      >
        {tiles.map((pos, index) => {
          const def = tileMap.get(pos.id);
          if (!def) return null;
          const Component = def.Component;
          const customGrid = isCustomTileId(pos.id) ? customGridMap.get(pos.id) : null;
          return (
            <div key={pos.id} style={{ position: "absolute", zIndex: index + 1, left: 0, top: 0 }}>
              <CanvasTile
                pos={pos}
                zoom={viewport.zoom}
                title={def.title}
                icon={def.icon}
                href={def.href ? def.href(tripId) : undefined}
                embed={pos.id !== "members"}
                onMove={moveTile}
                onResize={resizeTile}
                onFocus={bringToFront}
              >
                {customGrid ? (
                  <CustomGrid
                    tripId={tripId}
                    grid={customGrid}
                    onChange={handleCustomChange}
                    onDelete={handleCustomDelete}
                  />
                ) : (
                  <Component tripId={tripId} />
                )}
              </CanvasTile>
            </div>
          );
        })}
      </TripCanvas>
    </>
  );
}

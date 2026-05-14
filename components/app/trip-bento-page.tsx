"use client";

import { useEffect, useRef } from "react";
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
import {
  CommandPalette,
  useCommandPalette,
} from "@/components/app/command-palette";

/**
 * The single-page bento workspace. Replaces the previous tab-based layout —
 * every feature (itinerary, budget, tasks, ideas, votes, map, pack, members)
 * lives as its own bento grid tile on one scrollable page.
 *
 * Section IDs (`#hero`, `#itinerary`, …) are used by `TripTabs` for
 * scroll-spy anchor navigation, and by sub-route redirects so that legacy
 * `/app/trips/:id/itinerary` links land on the right tile.
 */
export function TripBentoPage({ tripId }: { tripId: string }) {
  const palette = useCommandPalette();
  const searchParams = useSearchParams();
  const tilesRef = useRef<HTMLDivElement>(null);

  // Scroll to the section requested via ?scroll=<id> (used by sub-route redirects).
  useEffect(() => {
    const id = searchParams?.get("scroll");
    if (!id) return;
    // Defer to next frame so grids have a chance to mount.
    const t = setTimeout(() => {
      const el = document.getElementById(id);
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
    return () => clearTimeout(t);
  }, [searchParams]);

  // Keyboard nav: j/k between tiles, ? opens command palette.
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
      const next = Math.max(
        0,
        Math.min(tiles.length - 1, idx < 0 ? 0 : idx + dir)
      );
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
        onAddItem={() => {
          // The command palette already routes new-item creation through
          // each tile's own dialogs; this hook stays here for parity with
          // the old overview.
        }}
      />

      <div ref={tilesRef} className="bento-grid">
        <div className="bento-cell-hero">
          <HeroGrid tripId={tripId} />
        </div>
        <div className="bento-cell-itinerary">
          <ItineraryGrid tripId={tripId} />
        </div>
        <div className="bento-cell-budget">
          <BudgetGrid tripId={tripId} />
        </div>
        <div className="bento-cell-tasks">
          <TaskGrid tripId={tripId} />
        </div>
        <div className="bento-cell-ideas">
          <IdeasGrid tripId={tripId} />
        </div>
        <div className="bento-cell-votes">
          <VotesGrid tripId={tripId} />
        </div>
        <div className="bento-cell-map">
          <MapGrid tripId={tripId} />
        </div>
        <div className="bento-cell-pack">
          <PackGrid tripId={tripId} />
        </div>
        <div className="bento-cell-members">
          <MembersGrid tripId={tripId} />
        </div>
      </div>

      <BentoGridStyles />
    </>
  );
}

/**
 * The bento grid template lives in a scoped <style> tag because the spans
 * are non-trivial and read more clearly as a single grid-template than as
 * a sprawl of utility classes. Mirrors the breakpoint rhythm in the
 * design brief (390 / 768 / 1024 / 1280).
 */
function BentoGridStyles() {
  return (
    <style>{`
      .bento-grid {
        display: grid;
        grid-template-columns: repeat(12, minmax(0, 1fr));
        gap: 1rem;
      }
      .bento-grid > * { min-width: 0; }
      .bento-grid > * > * { height: 100%; }

      /* Mobile: every tile spans the full width, vertical stack. */
      .bento-cell-hero,
      .bento-cell-itinerary,
      .bento-cell-budget,
      .bento-cell-tasks,
      .bento-cell-ideas,
      .bento-cell-votes,
      .bento-cell-map,
      .bento-cell-pack,
      .bento-cell-members {
        grid-column: span 12;
        min-height: 320px;
      }
      .bento-cell-hero { min-height: 260px; }

      /* Tablet: 2-up where it makes sense. */
      @media (min-width: 768px) {
        .bento-grid { gap: 1.25rem; }
        .bento-cell-budget,
        .bento-cell-tasks,
        .bento-cell-ideas,
        .bento-cell-votes,
        .bento-cell-map,
        .bento-cell-pack,
        .bento-cell-members {
          grid-column: span 6;
        }
      }

      /* Desktop: full bento layout. */
      @media (min-width: 1024px) {
        .bento-cell-hero      { grid-column: span 12; }
        .bento-cell-itinerary { grid-column: span 8; min-height: 480px; }
        .bento-cell-budget    { grid-column: span 4; min-height: 320px; }
        .bento-cell-votes     { grid-column: span 4; min-height: 280px; }
        .bento-cell-tasks     { grid-column: span 6; min-height: 420px; }
        .bento-cell-ideas     { grid-column: span 6; min-height: 420px; }
        .bento-cell-map       { grid-column: span 4; min-height: 320px; }
        .bento-cell-pack      { grid-column: span 4; min-height: 320px; }
        .bento-cell-members   { grid-column: span 4; min-height: 320px; }
      }

      @media (min-width: 1280px) {
        .bento-grid { gap: 1.5rem; }
      }
    `}</style>
  );
}

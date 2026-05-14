"use client";

import { TripBoardView } from "@/components/app/trip-board-view";
import { BentoCell } from "@/components/app/grids/grid-tile";

export function TaskGrid({ tripId }: { tripId: string }) {
  return (
    <BentoCell id="tasks">
      <TripBoardView tripId={tripId} />
    </BentoCell>
  );
}

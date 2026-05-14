"use client";

import { TripIdeasClient } from "@/components/app/trip-ideas";
import { BentoCell } from "@/components/app/grids/grid-tile";

export function IdeasGrid({ tripId }: { tripId: string }) {
  return (
    <BentoCell id="ideas">
      <TripIdeasClient tripId={tripId} />
    </BentoCell>
  );
}

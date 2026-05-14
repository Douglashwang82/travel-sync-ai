"use client";

import { TripPackClient } from "@/components/app/trip-pack";
import { BentoCell } from "@/components/app/grids/grid-tile";

export function PackGrid({ tripId }: { tripId: string }) {
  return (
    <BentoCell id="pack">
      <TripPackClient tripId={tripId} />
    </BentoCell>
  );
}

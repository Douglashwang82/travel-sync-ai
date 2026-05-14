"use client";

import { TripMapView } from "@/components/app/trip-map-view";
import { BentoCell } from "@/components/app/grids/grid-tile";

export function MapGrid({ tripId }: { tripId: string }) {
  return (
    <BentoCell id="map">
      <TripMapView tripId={tripId} />
    </BentoCell>
  );
}

"use client";

import { TripItineraryClient } from "@/components/app/trip-itinerary";
import { BentoCell } from "@/components/app/grids/grid-tile";

export function ItineraryGrid({ tripId }: { tripId: string }) {
  return (
    <BentoCell id="itinerary">
      <TripItineraryClient tripId={tripId} />
    </BentoCell>
  );
}

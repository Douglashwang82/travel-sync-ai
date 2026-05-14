"use client";

import { TripVotesClient } from "@/components/app/trip-votes";
import { BentoCell } from "@/components/app/grids/grid-tile";

export function VotesGrid({ tripId }: { tripId: string }) {
  return (
    <BentoCell id="votes">
      <TripVotesClient tripId={tripId} />
    </BentoCell>
  );
}

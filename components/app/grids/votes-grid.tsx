"use client";

import { TripVotesClient } from "@/components/app/trip-votes";

export function VotesGrid({ tripId }: { tripId: string }) {
  return <TripVotesClient tripId={tripId} />;
}

"use client";

import { TripItineraryClient } from "@/components/app/trip-itinerary";

export function ItineraryGrid({ tripId }: { tripId: string }) {
  return <TripItineraryClient tripId={tripId} />;
}

"use client";

import { TripIdeasClient } from "@/components/app/trip-ideas";

export function IdeasGrid({ tripId }: { tripId: string }) {
  return <TripIdeasClient tripId={tripId} />;
}

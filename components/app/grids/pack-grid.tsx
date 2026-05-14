"use client";

import { TripPackClient } from "@/components/app/trip-pack";

export function PackGrid({ tripId }: { tripId: string }) {
  return <TripPackClient tripId={tripId} />;
}

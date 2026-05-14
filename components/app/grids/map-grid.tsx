"use client";

import { TripMapView } from "@/components/app/trip-map-view";

export function MapGrid({ tripId }: { tripId: string }) {
  return <TripMapView tripId={tripId} />;
}

"use client";

import { TripBoardView } from "@/components/app/trip-board-view";

export function TaskGrid({ tripId }: { tripId: string }) {
  return <TripBoardView tripId={tripId} />;
}

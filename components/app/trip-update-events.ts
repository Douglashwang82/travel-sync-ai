"use client";

import type { Trip } from "@/lib/types";

export const TRIP_UPDATED_EVENT = "travel-sync-ai:trip-updated";

export interface TripUpdatedEventDetail {
  tripId: string;
  trip: Trip;
}

export function dispatchTripUpdated(trip: Trip) {
  window.dispatchEvent(
    new CustomEvent<TripUpdatedEventDetail>(TRIP_UPDATED_EVENT, {
      detail: { tripId: trip.id, trip },
    })
  );
}

export function isTripUpdatedEvent(
  event: Event
): event is CustomEvent<TripUpdatedEventDetail> {
  return event instanceof CustomEvent && event.type === TRIP_UPDATED_EVENT;
}

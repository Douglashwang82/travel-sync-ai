"use client";

import { TripCalendarClient } from "@/components/app/calendar/trip-calendar-client";

export function CalendarGrid({ tripId }: { tripId: string }) {
  return <TripCalendarClient tripId={tripId} />;
}

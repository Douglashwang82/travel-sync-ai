"use client";

import { TripExpensesClient } from "@/components/app/trip-expenses";

export function BudgetGrid({ tripId }: { tripId: string }) {
  return <TripExpensesClient tripId={tripId} />;
}

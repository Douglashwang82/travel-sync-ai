"use client";

import { TripExpensesClient } from "@/components/app/trip-expenses";
import { BentoCell } from "@/components/app/grids/grid-tile";

export function BudgetGrid({ tripId }: { tripId: string }) {
  return (
    <BentoCell id="budget">
      <TripExpensesClient tripId={tripId} />
    </BentoCell>
  );
}

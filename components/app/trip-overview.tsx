"use client";

import { TripOverviewBento } from "@/components/app/trip-overview-bento";

/**
 * Workspace Overview — the bento hero. The kanban board now lives at /board;
 * everything that used to be a stat sliver in `TripKpiStrip` is expressed
 * as a tile with a real job. Data fetching lives in `TripOverviewBento` and
 * preserves the existing `/api/app/trips/[tripId]/*` contracts.
 */
export function TripOverview({ tripId }: { tripId: string }) {
  return <TripOverviewBento tripId={tripId} />;
}

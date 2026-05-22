"use client";

import Link from "next/link";
import { TripMapView } from "@/components/app/trip-map-view";

export function MapGrid({ tripId }: { tripId: string }) {
  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center justify-end">
        <Link
          href={`/app/trips/${tripId}/map`}
          className="inline-flex items-center gap-1 rounded-full border border-[var(--border-hairline)] px-2.5 py-1 text-[11px] font-medium text-[var(--text-muted)] hover:bg-[var(--surface-sunken)] hover:text-[var(--text-primary)]"
        >
          開啟主地圖 ↗
        </Link>
      </div>
      <div className="min-h-0 flex-1">
        <TripMapView tripId={tripId} />
      </div>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { appFetchJson } from "@/lib/app-client";
import { TripHeroTile } from "@/components/app/trip-hero-tile";
import {
  BentoCell,
  GridTileSkeleton,
  GridTileError,
} from "@/components/app/grids/grid-tile";
import type { Trip } from "@/lib/types";
import type { AppMember } from "@/app/api/app/trips/[tripId]/members/route";

export function HeroGrid({ tripId }: { tripId: string }) {
  const router = useRouter();
  const [data, setData] = useState<{ trip: Trip; members: AppMember[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [tripRes, membersRes] = await Promise.all([
        appFetchJson<{ trip: Trip }>(`/api/app/trips/${tripId}`),
        appFetchJson<{ members: AppMember[] }>(
          `/api/app/trips/${tripId}/members`
        ),
      ]);
      setData({ trip: tripRes.trip, members: membersRes.members });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load trip");
    }
  }, [tripId]);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  return (
    <BentoCell id="hero" className="block h-full">
      {error && <GridTileError message={error} onRetry={() => void load()} />}
      {!error && !data && <GridTileSkeleton className="min-h-[260px]" />}
      {!error && data && (
        <TripHeroTile
          variant="balanced"
          trip={data.trip}
          members={data.members}
          groupName={null}
          lineDeepLink={null}
          tripId={tripId}
          onPrimary={() => router.push(`/app/trips/${tripId}/publish`)}
        />
      )}
    </BentoCell>
  );
}

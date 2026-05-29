import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/app-server";
import { listRoutesForDestination } from "@/services/trip-generation/route-engine";
import { loadPoisByIds } from "@/services/trip-generation/poi-engine";

export interface ExploreRoutePlace {
  placeId: string;
  name: string;
  itemType: string;
  lat: number;
  lng: number;
}

export interface ExploreRoute {
  routeId: string;
  title: string;
  summary: string;
  vibeTags: string[];
  pace: string;
  places: ExploreRoutePlace[];
}

export interface ExploreRoutesResponse {
  routes: ExploreRoute[];
}

const QuerySchema = z.object({
  destination: z.string().min(1).max(120),
  limit: z.coerce.number().int().min(1).max(40).optional(),
});

/**
 * GET /api/app/explore/routes?destination=<name>&limit=<n>
 *
 * Surfaces curated `route_templates` (ordered day plans) to the map explorer.
 * Each route's `place_ids` are resolved against `poi_embeddings` so the client
 * can draw the route as an ordered pin sequence + polyline. Routes whose places
 * can't be geocoded are dropped.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAppUser(req);
  if (!auth.ok) return auth.response;

  const parsed = QuerySchema.safeParse(
    Object.fromEntries(req.nextUrl.searchParams)
  );
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Validation failed",
        code: "VALIDATION_ERROR",
        details: parsed.error.flatten(),
      },
      { status: 400 }
    );
  }

  const { destination, limit } = parsed.data;

  const routes = await listRoutesForDestination(destination, limit ?? 20);
  const allIds = Array.from(new Set(routes.flatMap((r) => r.placeIds)));
  const pois = allIds.length > 0 ? await loadPoisByIds(allIds) : [];
  const byId = new Map(pois.map((p) => [p.placeId, p]));

  const out: ExploreRoute[] = routes
    .map((r) => ({
      routeId: r.routeId,
      title: r.title,
      summary: r.summary,
      vibeTags: r.vibeTags,
      pace: r.pace,
      places: r.placeIds
        .map((id) => byId.get(id))
        .filter(
          (p): p is NonNullable<typeof p> =>
            p != null && p.lat != null && p.lng != null
        )
        .map((p) => ({
          placeId: p.placeId,
          name: p.name,
          itemType: p.itemType,
          lat: p.lat as number,
          lng: p.lng as number,
        })),
    }))
    .filter((r) => r.places.length > 0);

  return NextResponse.json<ExploreRoutesResponse>({ routes: out });
}

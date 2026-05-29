import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/app-server";
import { searchPoisByText } from "@/services/trip-generation/poi-engine";

export interface ExplorePoi {
  placeId: string;
  name: string;
  itemType: string;
  tags: string[];
  description: string;
  lat: number;
  lng: number;
  similarity: number;
  googleMapsUrl: string;
}

export interface ExplorePoisResponse {
  pois: ExplorePoi[];
}

const ITEM_TYPES = ["hotel", "restaurant", "activity", "transport", "other"] as const;
type ExploreItemType = (typeof ITEM_TYPES)[number];

const QuerySchema = z.object({
  destination: z.string().min(1).max(120),
  q: z.string().max(120).optional(),
  /** Comma-separated item types to narrow the corpus query. */
  types: z.string().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(40).optional(),
});

/**
 * GET /api/app/explore/pois?destination=<name>&q=<text>&types=<csv>&limit=<n>
 *
 * Surfaces the curated `poi_embeddings` corpus to the map explorer. Semantic
 * search over the destination's POIs by free-text query (blank → "top
 * experiences"). Rows without coordinates are dropped — the explorer can only
 * pin geocoded places. Returns an empty list (not an error) when the corpus is
 * cold for the destination; the client falls back to live Google search.
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

  const { destination, q, types, limit } = parsed.data;
  const itemTypes = types
    ? types
        .split(",")
        .map((t) => t.trim())
        .filter((t): t is ExploreItemType =>
          (ITEM_TYPES as readonly string[]).includes(t)
        )
    : undefined;

  const candidates = await searchPoisByText({
    destination,
    query: q,
    itemTypes: itemTypes && itemTypes.length > 0 ? itemTypes : undefined,
    k: limit ?? 24,
  });

  const pois: ExplorePoi[] = candidates
    .filter((c) => c.lat != null && c.lng != null)
    .map((c) => ({
      placeId: c.placeId,
      name: c.name,
      itemType: c.itemType,
      tags: c.tags,
      description: c.description,
      lat: c.lat as number,
      lng: c.lng as number,
      similarity: c.similarity,
      googleMapsUrl: `https://www.google.com/maps/search/?api=1&query=${c.lat},${c.lng}`,
    }));

  return NextResponse.json<ExplorePoisResponse>({ pois });
}

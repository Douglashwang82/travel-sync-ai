import { NextRequest, NextResponse, after } from "next/server";
import { createAdminClient } from "@/lib/db";
import { requireAppTripAccess } from "@/lib/app-server";
import { geocodeAddress } from "@/services/decisions/places";

type RouteContext = { params: Promise<{ tripId: string }> };

export interface MemoryPin {
  id: string;
  title: string;
  itemType: string;
  summary: string | null;
  address: string | null;
  lat: number;
  lng: number;
  rating: number | null;
  priceLevel: string | null;
  imageUrl: string | null;
  bookingUrl: string | null;
  mentionCount: number;
  lastMentionedAt: string;
}

export interface MemoriesResponse {
  memories: MemoryPin[];
}

// Cap how many addressable-but-not-yet-geocoded rows we backfill in a single
// map load — geocoding is metered and we'd rather show the user something
// fast and have the rest fill in over subsequent visits.
const MAX_LAZY_GEOCODE_PER_REQUEST = 5;

export async function GET(
  req: NextRequest,
  ctx: RouteContext
): Promise<NextResponse> {
  const { tripId } = await ctx.params;
  const auth = await requireAppTripAccess(req, tripId);
  if (!auth.ok) return auth.response;

  const db = createAdminClient();
  const { data, error } = await db
    .from("trip_memories")
    .select(
      "id, title, item_type, summary, address, lat, lng, rating, price_level, image_url, booking_url, mention_count, last_mentioned_at"
    )
    .eq("trip_id", tripId);

  if (error) {
    return NextResponse.json(
      { error: "資料載入失敗", code: "DB_ERROR" },
      { status: 500 }
    );
  }

  const rows = data ?? [];

  // Lazy backfill: any row with an address but no coords gets geocoded in the
  // background via `after()` so this request returns fast.
  const stale = rows
    .filter((r) => r.address && (r.lat == null || r.lng == null))
    .slice(0, MAX_LAZY_GEOCODE_PER_REQUEST);

  if (stale.length > 0) {
    after(async () => {
      for (const row of stale) {
        try {
          const coords = await geocodeAddress(row.address as string);
          if (!coords) continue;
          await db
            .from("trip_memories")
            .update({ lat: coords.lat, lng: coords.lng })
            .eq("id", row.id as string);
        } catch (err) {
          console.error("[memories] background geocode failed", row.id, err);
        }
      }
    });
  }

  const memories: MemoryPin[] = rows
    .filter((r) => r.lat != null && r.lng != null)
    .map((r) => ({
      id: r.id as string,
      title: r.title as string,
      itemType: r.item_type as string,
      summary: (r.summary as string | null) ?? null,
      address: (r.address as string | null) ?? null,
      lat: Number(r.lat),
      lng: Number(r.lng),
      rating: r.rating != null ? Number(r.rating) : null,
      priceLevel: (r.price_level as string | null) ?? null,
      imageUrl: (r.image_url as string | null) ?? null,
      bookingUrl: (r.booking_url as string | null) ?? null,
      mentionCount: Number(r.mention_count ?? 0),
      lastMentionedAt: r.last_mentioned_at as string,
    }));

  return NextResponse.json<MemoriesResponse>({ memories });
}

/**
 * Cold-start the `poi_embeddings` corpus for a list of destinations.
 *
 * For each destination it pulls top results from Google Places per item-type
 * bucket (activity / restaurant / hotel), embeds the name+description with
 * Gemini text-embedding-004, and upserts into the table.
 *
 * Run:
 *   npx tsx --env-file=.env.local scripts/seed-poi-embeddings.ts \
 *     --destinations "Kyoto, Japan" "Taipei, Taiwan" "Bangkok, Thailand"
 *
 * Re-running is idempotent (place_id PK upsert). last_seen_at is bumped so
 * we can prune stale rows later.
 */

import { createAdminClient } from "@/lib/db";
import { generateEmbedding } from "@/lib/gemini";
import { searchPlaces, getPlaceDetails } from "@/services/decisions/places";
import type { ItemType } from "@/lib/types";

const BUCKETS: Array<{ type: "activity" | "restaurant" | "hotel"; queryType: ItemType; max: number }> = [
  { type: "activity", queryType: "activity", max: 15 },
  { type: "restaurant", queryType: "restaurant", max: 15 },
  { type: "hotel", queryType: "hotel", max: 8 },
];

async function seedDestination(destination: string): Promise<void> {
  console.log(`[seed] ${destination}`);
  const db = createAdminClient();

  for (const bucket of BUCKETS) {
    const res = await searchPlaces(destination, bucket.queryType, bucket.max);
    if (res.candidates.length === 0) {
      console.warn(`[seed]   ${bucket.type}: no candidates (${res.errorKind ?? "ok"})`);
      continue;
    }

    for (const c of res.candidates) {
      const details = await getPlaceDetails(c.placeId);
      const description = [c.name, details?.address, bucket.type].filter(Boolean).join(" — ");
      const embedding = await generateEmbedding(description);

      const { error } = await db.from("poi_embeddings").upsert(
        {
          place_id: c.placeId,
          destination_name: destination,
          name: c.name,
          item_type: bucket.type,
          tags: [],
          description,
          embedding,
          lat: details?.lat ?? null,
          lng: details?.lng ?? null,
          source: "google_places",
          last_seen_at: new Date().toISOString(),
        },
        { onConflict: "place_id" }
      );
      if (error) {
        console.error(`[seed]   upsert failed for ${c.placeId}`, error);
      } else {
        console.log(`[seed]   + ${bucket.type}: ${c.name}`);
      }
    }
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const flagIdx = args.indexOf("--destinations");
  if (flagIdx === -1 || flagIdx === args.length - 1) {
    console.error("Usage: tsx scripts/seed-poi-embeddings.ts --destinations 'City, Country' ...");
    process.exit(1);
  }
  const destinations = args.slice(flagIdx + 1);
  for (const d of destinations) {
    try {
      await seedDestination(d);
    } catch (err) {
      console.error(`[seed] ${d} failed`, err);
    }
  }
  console.log("[seed] done");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

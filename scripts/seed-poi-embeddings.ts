/**
 * Cold-start the `poi_embeddings` corpus.
 *
 * Two modes:
 * 1) Curated local data under ./data. This is the preferred repo bootstrap.
 * 2) Google Places search for arbitrary destinations.
 *
 * Run:
 *   npx tsx --env-file=.env.local scripts/seed-poi-embeddings.ts --from-data
 *
 *   npx tsx --env-file=.env.local scripts/seed-poi-embeddings.ts \
 *     --destinations "Kyoto, Japan" "Taipei, Taiwan" "Bangkok, Thailand"
 *
 * Re-running is idempotent (place_id PK upsert). last_seen_at is bumped so
 * we can prune stale rows later.
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { createAdminClient } from "@/lib/db";
import { generateEmbedding } from "@/lib/gemini";
import { searchPlaces, getPlaceDetails } from "@/services/decisions/places";
import type { ItemType } from "@/lib/types";

const BUCKETS: Array<{ type: "activity" | "restaurant" | "hotel"; queryType: ItemType; max: number }> = [
  { type: "activity", queryType: "activity", max: 15 },
  { type: "restaurant", queryType: "restaurant", max: 15 },
  { type: "hotel", queryType: "hotel", max: 8 },
];

type PoiItemType = "hotel" | "restaurant" | "activity" | "transport" | "other";

interface DataRecord {
  id?: unknown;
  name?: unknown;
  name_ja?: unknown;
  type?: unknown;
  category?: unknown;
  cuisine?: unknown;
  price_band?: unknown;
  village?: unknown;
  base_resort?: unknown;
  part_of?: unknown;
  address?: unknown;
  lat?: unknown;
  lng?: unknown;
  website?: unknown;
  booking_url?: unknown;
  url?: unknown;
  notes?: unknown;
  operator?: unknown;
  from?: unknown;
  to?: unknown;
  duration_min?: unknown;
  amenities?: unknown;
  tags?: unknown;
  [key: string]: unknown;
}

interface LocalPoi {
  placeId: string;
  destinationName: string;
  name: string;
  itemType: PoiItemType;
  tags: string[];
  description: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
}

const LOCAL_COLLECTIONS: Record<string, { key: string; itemType: PoiItemType }> = {
  "activities.json": { key: "activities", itemType: "activity" },
  "hotels.json": { key: "hotels", itemType: "hotel" },
  "restaurants.json": { key: "restaurants", itemType: "restaurant" },
  "resorts.json": { key: "resorts", itemType: "activity" },
  "transport.json": { key: "gateways", itemType: "transport" },
};

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

async function seedFromData(dataRoot = "data", destinationOverride?: string): Promise<void> {
  const root = path.resolve(process.cwd(), dataRoot);
  const files = await listJsonFiles(root);
  if (files.length === 0) {
    console.warn(`[seed:data] no JSON files found under ${root}`);
    return;
  }

  const db = createAdminClient();
  let total = 0;
  for (const filePath of files) {
    const pois = await readLocalPois(filePath, root, destinationOverride);
    if (pois.length === 0) continue;

    console.log(`[seed:data] ${path.relative(root, filePath)} (${pois.length})`);
    for (const poi of pois) {
      const embedding = await generateEmbedding(poi.description);
      const { error } = await db.from("poi_embeddings").upsert(
        {
          place_id: poi.placeId,
          destination_name: poi.destinationName,
          name: poi.name,
          item_type: poi.itemType,
          tags: poi.tags,
          description: poi.description,
          embedding,
          lat: poi.lat,
          lng: poi.lng,
          source: "local_data",
          last_seen_at: new Date().toISOString(),
        },
        { onConflict: "place_id" }
      );
      if (error) {
        console.error(`[seed:data]   upsert failed for ${poi.placeId}`, error);
      } else {
        await db.from("place_details_cache").upsert(
          {
            place_id: poi.placeId,
            payload: {
              placeId: poi.placeId,
              name: poi.name,
              address: poi.address,
              rating: null,
              priceLevel: null,
              lat: poi.lat,
              lng: poi.lng,
              openingPeriods: [],
            },
            fetched_at: new Date().toISOString(),
          },
          { onConflict: "place_id" }
        );
        total += 1;
        console.log(`[seed:data]   + ${poi.itemType}: ${poi.name}`);
      }
    }
  }
  console.log(`[seed:data] upserted ${total} POIs`);
}

async function listJsonFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await listJsonFiles(fullPath)));
    } else if (entry.isFile() && entry.name.endsWith(".json")) {
      out.push(fullPath);
    }
  }
  return out.sort();
}

async function readLocalPois(filePath: string, dataRoot: string, destinationOverride?: string): Promise<LocalPoi[]> {
  const fileName = path.basename(filePath);
  const config = LOCAL_COLLECTIONS[fileName];
  if (!config) return [];

  const raw = JSON.parse(await readFile(filePath, "utf8")) as Record<string, unknown>;
  const region = stringOrNull(raw.region);
  const country = stringOrNull(raw.country);
  const destinationName = destinationOverride ?? inferDestinationName(region, country, filePath);
  const records = Array.isArray(raw[config.key]) ? (raw[config.key] as DataRecord[]) : [];
  const prefix = path.relative(dataRoot, filePath).replace(/\\/g, "/").replace(/\.json$/, "");

  const pois = records.map((record) => toLocalPoi(record, config.itemType, destinationName, prefix)).filter((p): p is LocalPoi => p != null);

  if (fileName === "transport.json") {
    const routes = Array.isArray(raw.routes) ? (raw.routes as DataRecord[]) : [];
    const inResort = Array.isArray(raw.in_resort_transport) ? (raw.in_resort_transport as DataRecord[]) : [];
    pois.push(
      ...routes.map((record) => toLocalPoi(record, "transport", destinationName, `${prefix}/routes`)).filter((p): p is LocalPoi => p != null),
      ...inResort.map((record) => toLocalPoi(record, "transport", destinationName, `${prefix}/in_resort_transport`)).filter((p): p is LocalPoi => p != null)
    );
  }

  return pois;
}

function toLocalPoi(record: DataRecord, itemType: PoiItemType, destinationName: string, prefix: string): LocalPoi | null {
  const id = stringOrNull(record.id);
  const name = stringOrNull(record.name) ?? stringOrNull(record.operator);
  if (!id || !name) return null;

  const tags = deriveTags(record, itemType);
  const description = [
    name,
    stringOrNull(record.name_ja),
    `${itemType} in ${destinationName}`,
    stringOrNull(record.village) ? `area: ${stringOrNull(record.village)}` : null,
    stringOrNull(record.base_resort) ? `base: ${stringOrNull(record.base_resort)}` : null,
    stringOrNull(record.address),
    routeText(record),
    stringOrNull(record.notes),
    tags.length > 0 ? `tags: ${tags.join(", ")}` : null,
  ]
    .filter(Boolean)
    .join(" | ");

  return {
    placeId: `local:${prefix}/${id}`,
    destinationName,
    name,
    itemType,
    tags,
    description,
    address: stringOrNull(record.address),
    lat: numberOrNull(record.lat),
    lng: numberOrNull(record.lng),
  };
}

function deriveTags(record: DataRecord, itemType: PoiItemType): string[] {
  const raw = [
    itemType,
    record.type,
    record.category,
    record.cuisine,
    record.price_band,
    record.village,
    record.base_resort,
    record.part_of,
    ...(Array.isArray(record.amenities) ? record.amenities : []),
    ...(Array.isArray(record.tags) ? record.tags : []),
  ];
  return Array.from(
    new Set(
      raw
        .map((v) => stringOrNull(v)?.toLowerCase().replace(/\s+/g, "_"))
        .filter((v): v is string => v != null && v.length > 0)
    )
  ).slice(0, 16);
}

function routeText(record: DataRecord): string | null {
  const from = stringOrNull(record.from);
  const to = stringOrNull(record.to);
  const duration = numberOrNull(record.duration_min);
  if (!from && !to && duration == null) return null;
  return [`from: ${from ?? "n/a"}`, `to: ${to ?? "n/a"}`, duration != null ? `${duration} min` : null]
    .filter(Boolean)
    .join(", ");
}

function inferDestinationName(region: string | null, country: string | null, filePath: string): string {
  if (region && country) return `${region}, ${country}`;
  if (region && filePath.toLowerCase().includes("japan")) return `${region}, Japan`;
  return region ?? country ?? "Niseko, Japan";
}

function requireFlagValue(args: string[], flagIdx: number, flag: string): string {
  const value = args[flagIdx + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--from-data")) {
    const dataIdx = args.indexOf("--data-root");
    const destIdx = args.indexOf("--destination");
    await seedFromData(
      dataIdx === -1 ? "data" : requireFlagValue(args, dataIdx, "--data-root"),
      destIdx === -1 ? undefined : requireFlagValue(args, destIdx, "--destination")
    );
    console.log("[seed] done");
    return;
  }

  const flagIdx = args.indexOf("--destinations");
  if (flagIdx === -1 || flagIdx === args.length - 1) {
    console.error("Usage: tsx scripts/seed-poi-embeddings.ts --from-data [--data-root data] [--destination 'Niseko, Japan']");
    console.error("   or: tsx scripts/seed-poi-embeddings.ts --destinations 'City, Country' ...");
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

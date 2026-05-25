/**
 * Ingest the six deep-region Japan ski bundles into poi_embeddings.
 *
 *   data/japan-ski-trip/{niseko,hakuba,naeba,nozawa-onsen,shiga-kogen,zao-onsen}/
 *
 * Each region ships up to five JSON files (resorts, hotels, restaurants,
 * activities, transport). Rows are upserted on `place_id`; re-running is
 * safe.
 *
 * Run:
 *   npx tsx --env-file=.env.local scripts/ingest-ski-regions.ts             # all 6
 *   npx tsx --env-file=.env.local scripts/ingest-ski-regions.ts --regions niseko,hakuba
 *   npx tsx --env-file=.env.local scripts/ingest-ski-regions.ts --dry-run   # parse + report, no DB writes
 *
 * Complementary to scripts/ingest-ski-dataset.ts, which handles the
 * nationwide shallow index (33 resorts) under data/japan-ski-trip/national/.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createAdminClient } from "@/lib/db";
import { generateEmbedding } from "@/lib/gemini";
import {
  REGIONS,
  buildResortRow,
  buildHotelRow,
  buildRestaurantRow,
  buildActivityRow,
  buildTransportRow,
  type RegionMeta,
  type PoiUpsert,
} from "@/lib/ski-ingest";

interface CliArgs {
  regions: string[] | null;
  dryRun: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  let regions: string[] | null = null;
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") dryRun = true;
    else if (a === "--regions") {
      const next = argv[++i];
      if (!next) throw new Error("--regions requires a value");
      regions = next.split(",").map((s) => s.trim()).filter(Boolean);
    } else if (a.startsWith("--regions=")) {
      regions = a.slice("--regions=".length).split(",").map((s) => s.trim()).filter(Boolean);
    }
  }
  return { regions, dryRun };
}

function loadJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function buildRowsForRegion(meta: RegionMeta, baseDir: string): PoiUpsert[] {
  const rows: PoiUpsert[] = [];
  const dir = resolve(baseDir, meta.slug);

  const resorts = loadJson<{ resorts?: Parameters<typeof buildResortRow>[0][] }>(
    resolve(dir, "resorts.json"),
  );
  for (const r of resorts?.resorts ?? []) rows.push(buildResortRow(r, meta));

  const hotels = loadJson<{ hotels?: Parameters<typeof buildHotelRow>[0][] }>(
    resolve(dir, "hotels.json"),
  );
  for (const h of hotels?.hotels ?? []) rows.push(buildHotelRow(h, meta));

  const restaurants = loadJson<{ restaurants?: Parameters<typeof buildRestaurantRow>[0][] }>(
    resolve(dir, "restaurants.json"),
  );
  for (const r of restaurants?.restaurants ?? []) rows.push(buildRestaurantRow(r, meta));

  const activities = loadJson<{ activities?: Parameters<typeof buildActivityRow>[0][] }>(
    resolve(dir, "activities.json"),
  );
  for (const a of activities?.activities ?? []) rows.push(buildActivityRow(a, meta));

  const transport = loadJson<{ gateways?: Parameters<typeof buildTransportRow>[0][] }>(
    resolve(dir, "transport.json"),
  );
  for (const t of transport?.gateways ?? []) rows.push(buildTransportRow(t, meta));

  return rows;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const baseDir = resolve(process.cwd(), "data/japan-ski-trip");

  const selected = args.regions
    ? REGIONS.filter((r) => args.regions!.includes(r.slug))
    : REGIONS;

  if (args.regions && selected.length !== args.regions.length) {
    const known = new Set(REGIONS.map((r) => r.slug));
    const missing = args.regions.filter((r) => !known.has(r));
    if (missing.length > 0) {
      throw new Error(`Unknown region slug(s): ${missing.join(", ")}. Known: ${REGIONS.map((r) => r.slug).join(", ")}`);
    }
  }

  console.log(`[ski-regions] ingesting ${selected.length} region(s): ${selected.map((r) => r.slug).join(", ")}${args.dryRun ? " [dry-run]" : ""}`);

  const db = args.dryRun ? null : createAdminClient();
  let totalOk = 0;
  let totalFail = 0;

  for (const meta of selected) {
    const rows = buildRowsForRegion(meta, baseDir);
    const counts = rows.reduce<Record<string, number>>((acc, r) => {
      acc[r.item_type] = (acc[r.item_type] ?? 0) + 1;
      return acc;
    }, {});
    console.log(`[ski-regions] ${meta.slug}: ${rows.length} rows (${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(", ")})`);

    if (args.dryRun) {
      totalOk += rows.length;
      continue;
    }

    for (const row of rows) {
      try {
        const embedding = await generateEmbedding(row.embedText);
        const { error } = await db!.from("poi_embeddings").upsert(
          {
            place_id: row.place_id,
            destination_name: row.destination_name,
            destination_aliases: row.destination_aliases,
            name: row.name,
            item_type: row.item_type,
            tags: row.tags,
            description: row.description,
            embedding,
            lat: row.lat,
            lng: row.lng,
            live_data: row.live_data,
            source: row.source,
            last_seen_at: new Date().toISOString(),
          },
          { onConflict: "place_id" },
        );
        if (error) {
          console.error(`[ski-regions]   x ${row.place_id}: ${error.message}`);
          totalFail++;
        } else {
          totalOk++;
        }
      } catch (err) {
        console.error(`[ski-regions]   x ${row.place_id}:`, err);
        totalFail++;
      }
    }
  }

  console.log(`[ski-regions] done: ${totalOk} ok, ${totalFail} failed`);
  if (totalFail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

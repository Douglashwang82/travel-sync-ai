/**
 * Bridge the curated `data/japan-ski-trip/national/resorts.json` dataset into:
 *
 *   1. `poi_embeddings`  — one row per resort, using the resort's slug as
 *                          place_id (the column is plain TEXT, not constrained
 *                          to Google Places IDs).
 *   2. `seeds/routes/japan-ski-<prefecture>.json` — per-prefecture route seed
 *                          files consumable by scripts/seed-route-templates.ts.
 *                          Each route is a single-stop "ski day at <resort>"
 *                          curated entry the orchestrator can promote.
 *
 * Run:
 *   npx tsx --env-file=.env.local scripts/ingest-ski-dataset.ts            # both
 *   npx tsx --env-file=.env.local scripts/ingest-ski-dataset.ts --pois-only
 *   npx tsx --env-file=.env.local scripts/ingest-ski-dataset.ts --routes-only
 *
 * After this, finalize routes with:
 *   for f in seeds/routes/japan-ski-*.json; do
 *     npx tsx --env-file=.env.local scripts/seed-route-templates.ts --file "$f"
 *   done
 *
 * Idempotent on both sides: poi_embeddings upserts on place_id; the route seed
 * step upserts on (destination, title).
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createAdminClient } from "@/lib/db";
import { generateEmbedding } from "@/lib/gemini";

// ─── Input shape (matches data/japan-ski-trip/national/resorts.json) ─────────

interface Resort {
  id: string;
  name: string;
  name_ja: string;
  name_zh: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  website: string | null;
  lifts: number | null;
  courses: number | null;
  vertical_m: number | null;
  top_elevation_m: number | null;
  base_elevation_m: number | null;
  longest_run_m: number | null;
  night_skiing: boolean;
  onsen: boolean;
  wifi: boolean;
  difficulty_levels: string[];
  description_zh: string;
  notes: string;
}

interface RegionBlock {
  prefecture: string;
  country: string;
  resorts: Resort[];
}

interface NationalIndex {
  country: string;
  regions: RegionBlock[];
}

// ─── Derived fields ──────────────────────────────────────────────────────────

function destinationFor(prefecture: string): string {
  return `${prefecture}, Japan`;
}

function vibeTagsFor(r: Resort): string[] {
  const tags = new Set<string>(["ski", "snow", "winter"]);
  if (r.onsen) {
    tags.add("onsen");
    tags.add("relaxed");
  }
  if (r.night_skiing) tags.add("nightlife");
  if (r.difficulty_levels.includes("advanced")) tags.add("adventure");
  if (
    r.difficulty_levels.length > 0 &&
    !r.difficulty_levels.includes("advanced")
  ) {
    tags.add("family");
  }
  return Array.from(tags);
}

// ─── Live data (default ski lift hours) ──────────────────────────────────────
// Approximated, not researched per-resort: 08:30–16:30 daytime everywhere,
// plus 17:00–20:30 for resorts with night_skiing=true. Individual schedules
// drift week-to-week in practice; refine here when we want resort-specific
// hours.

const DAY_OPEN_MIN = 8 * 60 + 30;   // 08:30
const DAY_CLOSE_MIN = 16 * 60 + 30; // 16:30
const NIGHT_OPEN_MIN = 17 * 60;     // 17:00
const NIGHT_CLOSE_MIN = 20 * 60 + 30; // 20:30

interface OpeningPeriod {
  openDay: number;
  openMinutes: number;
  closeDay: number;
  closeMinutes: number;
}

interface PlaceLiveDataShape {
  placeId: string;
  name: string | null;
  address: string | null;
  rating: number | null;
  priceLevel: string | null;
  lat: number | null;
  lng: number | null;
  openingPeriods: OpeningPeriod[];
}

function liveDataFor(r: Resort): PlaceLiveDataShape {
  const periods: OpeningPeriod[] = [];
  for (let d = 0; d < 7; d++) {
    periods.push({ openDay: d, openMinutes: DAY_OPEN_MIN, closeDay: d, closeMinutes: DAY_CLOSE_MIN });
    if (r.night_skiing) {
      periods.push({ openDay: d, openMinutes: NIGHT_OPEN_MIN, closeDay: d, closeMinutes: NIGHT_CLOSE_MIN });
    }
  }
  return {
    placeId: r.id,
    name: r.name,
    address: r.address,
    rating: null,
    priceLevel: null,
    lat: r.lat,
    lng: r.lng,
    openingPeriods: periods,
  };
}

function poiEmbeddingText(r: Resort, prefecture: string): string {
  // Mirror buildVibeQuery's surface shape so this corpus lives in the same
  // semantic space as Google-Places-sourced rows.
  const facilities = [
    r.onsen ? "onsen" : null,
    r.night_skiing ? "night skiing" : null,
    `${r.lifts ?? "several"} lifts`,
    `${r.courses ?? "various"} courses`,
  ]
    .filter(Boolean)
    .join(", ");
  return `Ski resort in ${prefecture}, Japan. ${r.name} (${r.name_zh}). ${facilities}. ${r.notes}`;
}

function routeTitleFor(r: Resort): string {
  return `${r.name_zh} 滑雪一日`;
}

function routeSummaryFor(r: Resort): string {
  // Keep under route_templates schema's effective limit (PickSchema summary
  // max is 800 chars; we go well below). description_zh + a short English
  // tail keeps both languages present so the embedding picks up either side.
  const base = r.description_zh.slice(0, 400);
  const tail = ` ${r.notes}`.slice(0, 200);
  return `${base}${tail}`.slice(0, 600);
}

// ─── Ingestion ───────────────────────────────────────────────────────────────

async function ingestPois(index: NationalIndex): Promise<void> {
  const db = createAdminClient();
  let ok = 0;
  let fail = 0;

  for (const region of index.regions) {
    console.log(`[pois] ${region.prefecture} (${region.resorts.length})`);
    for (const r of region.resorts) {
      try {
        const embedding = await generateEmbedding(poiEmbeddingText(r, region.prefecture));
        const { error } = await db.from("poi_embeddings").upsert(
          {
            place_id: r.id,
            destination_name: destinationFor(region.prefecture),
            name: r.name,
            item_type: "activity",
            tags: vibeTagsFor(r),
            description: r.notes,
            embedding,
            lat: r.lat,
            lng: r.lng,
            live_data: liveDataFor(r),
            source: "curated:japan-ski-national",
            last_seen_at: new Date().toISOString(),
          },
          { onConflict: "place_id" }
        );
        if (error) {
          console.error(`[pois]   ✗ ${r.id}: ${error.message}`);
          fail++;
        } else {
          console.log(`[pois]   + ${r.id}`);
          ok++;
        }
      } catch (err) {
        console.error(`[pois]   ✗ ${r.id}:`, err);
        fail++;
      }
    }
  }
  console.log(`[pois] done: ${ok} ok, ${fail} failed`);
}

// ─── Route seed generation ───────────────────────────────────────────────────

function writeRouteSeeds(index: NationalIndex, outDir: string): void {
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  let total = 0;

  for (const region of index.regions) {
    const seed = {
      destination: destinationFor(region.prefecture),
      routes: region.resorts.map((r) => ({
        title: routeTitleFor(r),
        summary: routeSummaryFor(r),
        vibe_tags: vibeTagsFor(r),
        pace: "balanced" as const,
        place_ids: [r.id],
        pinned_vibes: ["ski"],
      })),
    };
    const slug = region.prefecture.toLowerCase().replace(/\s+/g, "-");
    const path = resolve(outDir, `japan-ski-${slug}.json`);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(seed, null, 2) + "\n", "utf8");
    console.log(`[routes] wrote ${path} (${seed.routes.length} routes)`);
    total += seed.routes.length;
  }
  console.log(`[routes] done: ${total} routes across ${index.regions.length} files`);
}

// ─── Entry ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const poisOnly = args.includes("--pois-only");
  const routesOnly = args.includes("--routes-only");
  if (poisOnly && routesOnly) {
    console.error("--pois-only and --routes-only are mutually exclusive");
    process.exit(1);
  }

  const inputPath = resolve(process.cwd(), "data/japan-ski-trip/national/resorts.json");
  const raw = readFileSync(inputPath, "utf8");
  const index = JSON.parse(raw) as NationalIndex;

  if (!routesOnly) {
    await ingestPois(index);
  }
  if (!poisOnly) {
    writeRouteSeeds(index, resolve(process.cwd(), "seeds/routes"));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

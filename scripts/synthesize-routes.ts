/**
 * Cold-start the `route_templates` corpus from existing POIs.
 *
 * Reads every distinct destination from `poi_embeddings`, clusters its POIs
 * geographically, and emits multi-stop day routes per pace. Each generated
 * route gets a Gemini-authored title + summary, is written to a seed JSON
 * file under `seeds/routes/<slug>-synth.json` (same shape as curated seeds),
 * and is upserted into `route_templates` with `source = 'synthesized'`.
 *
 * Idempotency:
 *   • Title cache (`seeds/routes/.synth-cache/<hash>.json`) keys by
 *     sorted place_ids + pace, so re-runs reuse titles and the
 *     (destination, lower(title)) unique index doesn't churn.
 *   • Upsert leaves admin-mutated columns (boost, quality_score,
 *     is_archived) alone — see scripts/seed-route-templates.ts.
 *
 * Run:
 *   npx tsx --env-file=.env.local scripts/synthesize-routes.ts
 *   npx tsx --env-file=.env.local scripts/synthesize-routes.ts \
 *     --destination "Nozawa Onsen, Japan"
 *   npx tsx --env-file=.env.local scripts/synthesize-routes.ts \
 *     --no-llm --no-seed-db        # template titles, JSON only
 *
 * Flags:
 *   --destination <name>   Run for a single destination instead of all.
 *   --no-llm               Use template titles/summaries (skip Gemini).
 *   --no-seed-db           Skip the route_templates upsert (JSON only).
 *   --cluster-radius-km N  Override cluster radius (default 1.5).
 *   --max-routes N         Cap total synthesized routes per destination.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import { createAdminClient } from "@/lib/db";
import {
  generateEmbedding,
  generateJson,
  GeminiUnavailableError,
} from "@/lib/gemini";
import { normalizeAliases } from "@/lib/destination-aliases";
import {
  synthesizeRoutes,
  type Pace,
  type SynthesizedRoute,
  SYNTH_TUNABLES,
} from "@/services/trip-generation/route-synthesizer";
import type { PoiCandidate } from "@/services/trip-generation/poi-engine";

interface CliArgs {
  destination?: string;
  noLlm: boolean;
  noSeedDb: boolean;
  clusterRadiusKm: number;
  maxRoutes: number;
}

function parseArgs(): CliArgs {
  const argv = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i === -1 || i === argv.length - 1 ? undefined : argv[i + 1];
  };
  const radiusRaw = get("--cluster-radius-km");
  const maxRaw = get("--max-routes");
  return {
    destination: get("--destination"),
    noLlm: argv.includes("--no-llm"),
    noSeedDb: argv.includes("--no-seed-db"),
    clusterRadiusKm: radiusRaw ? Number(radiusRaw) : SYNTH_TUNABLES.CLUSTER_RADIUS_KM,
    maxRoutes: maxRaw ? Number(maxRaw) : 200,
  };
}

// ─── Title/summary cache ─────────────────────────────────────────────────────
// Keep per-route titles deterministic across runs so the unique index
// (destination, lower(title)) doesn't accumulate duplicates each time.

const CACHE_DIR = path.join("seeds", "routes", ".synth-cache");

interface CachedTitle {
  title: string;
  summary: string;
  vibeTags?: string[];
}

function cacheKey(destination: string, route: SynthesizedRoute): string {
  const h = createHash("sha1");
  h.update(destination.toLowerCase().trim());
  h.update("|");
  h.update(route.pace);
  h.update("|");
  h.update(route.placeIds.slice().sort().join(","));
  return h.digest("hex").slice(0, 16);
}

async function readCache(key: string): Promise<CachedTitle | null> {
  const file = path.join(CACHE_DIR, `${key}.json`);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(await readFile(file, "utf8")) as CachedTitle;
  } catch {
    return null;
  }
}

async function writeCache(key: string, payload: CachedTitle): Promise<void> {
  if (!existsSync(CACHE_DIR)) await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(path.join(CACHE_DIR, `${key}.json`), JSON.stringify(payload, null, 2));
}

// ─── Title generation ────────────────────────────────────────────────────────

const TitleSchema = z.object({
  title: z.string().min(2).max(80),
  summary: z.string().min(20).max(400),
  vibe_tags: z.array(z.string()).max(6).default([]),
});

async function generateTitle(
  destination: string,
  route: SynthesizedRoute,
  useLlm: boolean
): Promise<CachedTitle> {
  const stopsLine = route.pois
    .map((p) => `${p.itemType[0].toUpperCase()}: ${p.name}${p.tags.length ? ` [${p.tags.join(", ")}]` : ""}`)
    .join(" → ");

  if (!useLlm) {
    return templateTitle(destination, route, stopsLine);
  }

  const system =
    "You name short 1-day travel routes. Voice: concrete, calm, no fluff. " +
    "Return JSON {title, summary, vibe_tags}. " +
    "Title: 2–8 words, evocative, mention a neighborhood or theme if one is obvious. " +
    "Summary: 1–2 sentences, ≤350 chars, describe the arc of the day (morning → meal → afternoon). " +
    "vibe_tags: 2–5 lowercase short tags from the stops (e.g. 'foodie', 'culture', 'onsen', 'ski').";
  const user = [
    `Destination: ${destination}`,
    `Pace: ${route.pace} (${route.placeIds.length} stops)`,
    `Cluster centroid: (${route.centroidLat.toFixed(4)}, ${route.centroidLng.toFixed(4)})`,
    `Stops (in order): ${stopsLine}`,
    `Stop tags union: ${route.vibeTags.join(", ") || "(none)"}`,
  ].join("\n");

  try {
    const out = await generateJson(system, user, TitleSchema);
    return { title: out.title, summary: out.summary, vibeTags: out.vibe_tags };
  } catch (err) {
    if (err instanceof GeminiUnavailableError) {
      console.warn(`[synth] gemini unavailable, falling back to template`);
    } else {
      console.warn(`[synth] gemini failed: ${err instanceof Error ? err.message : err}`);
    }
    return templateTitle(destination, route, stopsLine);
  }
}

function templateTitle(
  destination: string,
  route: SynthesizedRoute,
  stopsLine: string
): CachedTitle {
  const firstActivity = route.pois.find((p) => p.itemType === "activity");
  const anchor = firstActivity?.name ?? route.pois[0].name;
  const paceWord = { chill: "Stroll", balanced: "Day", packed: "Marathon" }[route.pace];
  const title = `${anchor} ${paceWord}`.slice(0, 80);
  const summary =
    `A ${route.pace}-paced day in ${destination} centered on ${anchor}. ${stopsLine}.`.slice(
      0,
      390
    );
  return { title, summary, vibeTags: route.vibeTags };
}

// ─── Per-destination pipeline ────────────────────────────────────────────────

interface ScriptedRoute {
  title: string;
  summary: string;
  vibe_tags: string[];
  pace: Pace;
  place_ids: string[];
  pinned_vibes: string[];
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

async function loadPois(destination: string): Promise<PoiCandidate[]> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("poi_embeddings")
    .select("place_id, name, item_type, tags, description, lat, lng")
    .eq("destination_name", destination);
  if (error) throw new Error(`poi_embeddings load failed: ${error.message}`);
  return (data ?? []).map((r) => ({
    placeId: r.place_id as string,
    name: r.name as string,
    itemType: (r.item_type ?? "other") as PoiCandidate["itemType"],
    tags: (r.tags as string[] | null) ?? [],
    description: (r.description as string | null) ?? "",
    lat: r.lat as number | null,
    lng: r.lng as number | null,
    similarity: 1,
  }));
}

async function listDestinations(): Promise<string[]> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("poi_embeddings")
    .select("destination_name");
  if (error) throw new Error(`destinations load failed: ${error.message}`);
  const seen = new Set<string>();
  for (const r of data ?? []) {
    const d = (r.destination_name as string | null)?.trim();
    if (d) seen.add(d);
  }
  return [...seen].sort();
}

async function runForDestination(destination: string, args: CliArgs): Promise<void> {
  const pois = await loadPois(destination);
  if (pois.length === 0) {
    console.log(`[synth] ${destination}: no POIs, skipping`);
    return;
  }

  const synthesized = synthesizeRoutes(pois, {
    clusterRadiusKm: args.clusterRadiusKm,
  }).slice(0, args.maxRoutes);

  if (synthesized.length === 0) {
    console.log(`[synth] ${destination}: 0 routes (insufficient activities/restaurants)`);
    return;
  }

  console.log(`[synth] ${destination}: ${pois.length} POIs → ${synthesized.length} routes`);

  const scripted: ScriptedRoute[] = [];
  for (const route of synthesized) {
    const key = cacheKey(destination, route);
    let title = await readCache(key);
    if (!title) {
      title = await generateTitle(destination, route, !args.noLlm);
      await writeCache(key, title);
    }
    scripted.push({
      title: title.title,
      summary: title.summary,
      vibe_tags: title.vibeTags ?? route.vibeTags,
      pace: route.pace,
      place_ids: route.placeIds,
      pinned_vibes: route.pinnedVibes,
    });
    console.log(`[synth]   + ${title.title} (${route.pace}, ${route.placeIds.length} stops)`);
  }

  await writeSeedFile(destination, scripted);
  if (!args.noSeedDb) await seedDb(destination, scripted);
}

async function writeSeedFile(destination: string, routes: ScriptedRoute[]): Promise<void> {
  const dir = "seeds/routes";
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${slugify(destination)}-synth.json`);
  const payload = {
    destination,
    destination_aliases: [],
    _generated_by: "scripts/synthesize-routes.ts",
    routes,
  };
  await writeFile(file, JSON.stringify(payload, null, 2) + "\n");
  console.log(`[synth]   wrote ${file}`);
}

async function seedDb(destination: string, routes: ScriptedRoute[]): Promise<void> {
  const db = createAdminClient();
  const aliases = normalizeAliases([destination]);
  for (const route of routes) {
    const embedText = `Travel experiences in ${destination} for a ${route.pace}-paced trip with a ${
      route.vibe_tags.join(", ") || "balanced"
    } vibe. ${route.title}. ${route.summary}`;
    let embedding: number[];
    try {
      embedding = await generateEmbedding(embedText);
    } catch (err) {
      console.warn(`[synth]   ✗ embedding failed for ${route.title}: ${err instanceof Error ? err.message : err}`);
      continue;
    }
    const { error } = await db.from("route_templates").upsert(
      {
        destination_name: destination,
        destination_aliases: aliases,
        title: route.title,
        summary: route.summary,
        vibe_tags: route.vibe_tags,
        pace: route.pace,
        place_ids: route.place_ids,
        pinned_vibes: route.pinned_vibes,
        embedding,
        source: "synthesized",
        last_health_ok_at: new Date().toISOString(),
      },
      { onConflict: "destination_name,title", ignoreDuplicates: false }
    );
    if (error) {
      console.error(`[synth]   ✗ upsert ${route.title}: ${error.message}`);
    }
  }
}

async function main(): Promise<void> {
  const args = parseArgs();
  const destinations = args.destination ? [args.destination] : await listDestinations();
  if (destinations.length === 0) {
    console.log("[synth] no destinations found in poi_embeddings");
    return;
  }
  console.log(`[synth] running over ${destinations.length} destination(s)`);
  for (const dest of destinations) {
    try {
      await runForDestination(dest, args);
    } catch (err) {
      console.error(`[synth] ${dest} failed:`, err);
    }
  }
  console.log("[synth] done");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

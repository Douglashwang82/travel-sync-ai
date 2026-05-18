/**
 * Cold-start the `route_templates` corpus from a curated JSON file.
 *
 * Each entry references existing `poi_embeddings.place_id`s, so the embedding
 * is computed from the route's title + summary + vibe_tags only; the route
 * inherits its geographic anchoring from the POIs it references.
 *
 * Run:
 *   npx tsx --env-file=.env.local scripts/seed-route-templates.ts \
 *     --file seeds/routes/kyoto.json
 *
 * Idempotent via the (lower(destination_name), lower(title)) unique index.
 * Re-running refreshes curator-owned fields (summary, vibe_tags, pace,
 * place_ids, pinned_vibes, embedding) and preserves admin-mutated state
 * (boost, quality_score, is_archived) because those columns aren't in the
 * upsert payload.
 *
 * File schema (JSON):
 *   {
 *     "destination": "Kyoto, Japan",
 *     "routes": [
 *       {
 *         "title": "Gion Cultural Morning",
 *         "summary": "Slow walk through Gion → Kennin-ji → Nishiki lunch.",
 *         "vibe_tags": ["culture", "foodie"],
 *         "pace": "balanced",
 *         "place_ids": ["ChIJ...", "ChIJ...", "ChIJ..."],
 *         "pinned_vibes": ["culture"]
 *       }
 *     ]
 *   }
 */

import { readFileSync } from "node:fs";
import { createAdminClient } from "@/lib/db";
import { generateEmbedding } from "@/lib/gemini";
import { normalizeAliases } from "@/lib/destination-aliases";

interface RouteSeed {
  title: string;
  summary: string;
  vibe_tags: string[];
  pace: "chill" | "balanced" | "packed";
  place_ids: string[];
  pinned_vibes?: string[];
}

interface SeedFile {
  destination: string;
  /**
   * Optional aliases applied to every route in the file. Combined with the
   * destination name itself; normalized (lowercased, trimmed, deduped) before
   * being written so the alias-aware RPCs can `lower($1) = any(aliases)`.
   */
  destination_aliases?: string[];
  routes: RouteSeed[];
}

function buildEmbeddingText(seed: RouteSeed, destination: string): string {
  // Mirror the runtime query shape from buildVibeQuery in poi-engine.ts so
  // seed-time and retrieval-time embeddings live in the same semantic space.
  const vibes = seed.vibe_tags.join(", ") || "balanced";
  return `Travel experiences in ${destination} for a ${seed.pace}-paced trip with a ${vibes} vibe. ${seed.title}. ${seed.summary}`;
}

async function validatePlaceIds(placeIds: string[]): Promise<{ missing: string[] }> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("poi_embeddings")
    .select("place_id")
    .in("place_id", placeIds);
  if (error) throw new Error(`poi_embeddings lookup failed: ${error.message}`);
  const found = new Set((data ?? []).map((r) => r.place_id as string));
  return { missing: placeIds.filter((id) => !found.has(id)) };
}

async function seedRoute(
  destination: string,
  aliases: string[],
  seed: RouteSeed
): Promise<void> {
  const { missing } = await validatePlaceIds(seed.place_ids);
  if (missing.length > 0) {
    console.error(`[seed]   ✗ ${seed.title}: missing place_ids: ${missing.join(", ")}`);
    console.error(`[seed]     run seed-poi-embeddings.ts for "${destination}" first`);
    return;
  }

  const embedding = await generateEmbedding(buildEmbeddingText(seed, destination));
  const db = createAdminClient();

  const { error } = await db.from("route_templates").upsert(
    {
      destination_name: destination,
      destination_aliases: aliases,
      title: seed.title,
      summary: seed.summary,
      vibe_tags: seed.vibe_tags,
      pace: seed.pace,
      place_ids: seed.place_ids,
      pinned_vibes: seed.pinned_vibes ?? [],
      embedding,
      source: "curated",
      last_health_ok_at: new Date().toISOString(),
    },
    { onConflict: "destination_name,title", ignoreDuplicates: false }
  );

  if (error) {
    console.error(`[seed]   ✗ ${seed.title}: ${error.message}`);
  } else {
    console.log(`[seed]   + ${seed.title} (${seed.place_ids.length} stops, ${seed.pace})`);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const flagIdx = args.indexOf("--file");
  if (flagIdx === -1 || flagIdx === args.length - 1) {
    console.error("Usage: tsx scripts/seed-route-templates.ts --file <path-to-json>");
    process.exit(1);
  }
  const path = args[flagIdx + 1];

  const raw = readFileSync(path, "utf8");
  const file = JSON.parse(raw) as SeedFile;
  if (!file.destination || !Array.isArray(file.routes)) {
    console.error("[seed] invalid seed file: expected { destination, routes[] }");
    process.exit(1);
  }

  // The canonical destination_name is always the first alias (after
  // normalization) so the RPCs match it via either branch of the OR.
  const aliases = normalizeAliases([file.destination, ...(file.destination_aliases ?? [])]);

  console.log(`[seed] ${file.destination} (${file.routes.length} routes, ${aliases.length} aliases)`);
  for (const route of file.routes) {
    try {
      await seedRoute(file.destination, aliases, route);
    } catch (err) {
      console.error(`[seed]   ✗ ${route.title}:`, err);
    }
  }
  console.log("[seed] done");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

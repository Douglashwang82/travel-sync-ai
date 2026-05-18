/**
 * Mutate a route's promotion levers without re-seeding.
 *
 * Run:
 *   npx tsx --env-file=.env.local scripts/promote-route.ts \
 *     --id <route-uuid> [--boost <number>] [--pin <vibe,vibe,...>] [--unarchive]
 *
 * Examples:
 *   # Push a route higher in retrieval ranking
 *   promote-route.ts --id 7f3... --boost 0.2
 *
 *   # Pin to specific vibes (replaces existing pinned_vibes)
 *   promote-route.ts --id 7f3... --pin foodie,culture
 *
 *   # Demote a route without archiving it
 *   promote-route.ts --id 7f3... --boost -0.1
 *
 * Boost is additive to similarity at retrieval time (see ROUTE_TUNABLES in
 * services/trip-generation/route-engine.ts). The hard gate is 0.72 — a +0.2
 * boost can rescue a 0.55-similarity route, and a -0.2 boost can demote a
 * 0.85-similarity one below the gate.
 */

import { createAdminClient } from "@/lib/db";

interface PromoteArgs {
  id: string;
  boost?: number;
  pin?: string[];
  unarchive?: boolean;
}

function parseArgs(): PromoteArgs {
  const argv = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i === -1 || i === argv.length - 1 ? undefined : argv[i + 1];
  };

  const id = get("--id");
  if (!id) {
    console.error("Missing required --id <route-uuid>");
    process.exit(1);
  }

  const boostRaw = get("--boost");
  const boost = boostRaw == null ? undefined : Number(boostRaw);
  if (boost != null && !Number.isFinite(boost)) {
    console.error(`Invalid --boost value: ${boostRaw}`);
    process.exit(1);
  }

  const pinRaw = get("--pin");
  const pin = pinRaw == null ? undefined : pinRaw.split(",").map((s) => s.trim()).filter(Boolean);

  const unarchive = argv.includes("--unarchive");

  if (boost == null && pin == null && !unarchive) {
    console.error("Nothing to do — pass at least one of --boost, --pin, --unarchive");
    process.exit(1);
  }

  return { id, boost, pin, unarchive };
}

async function main(): Promise<void> {
  const args = parseArgs();
  const db = createAdminClient();

  const patch: Record<string, unknown> = {};
  if (args.boost != null) patch.boost = args.boost;
  if (args.pin != null) patch.pinned_vibes = args.pin;
  if (args.unarchive) patch.is_archived = false;

  const { data, error } = await db
    .from("route_templates")
    .update(patch)
    .eq("id", args.id)
    .select("id, title, destination_name, boost, pinned_vibes, is_archived")
    .single();

  if (error) {
    console.error("[promote] update failed:", error.message);
    process.exit(1);
  }
  if (!data) {
    console.error(`[promote] no route found with id=${args.id}`);
    process.exit(1);
  }

  console.log("[promote] updated:");
  console.log(`  id:           ${data.id}`);
  console.log(`  title:        ${data.title}`);
  console.log(`  destination:  ${data.destination_name}`);
  console.log(`  boost:        ${data.boost}`);
  console.log(`  pinned_vibes: ${(data.pinned_vibes ?? []).join(", ") || "(none)"}`);
  console.log(`  is_archived:  ${data.is_archived}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

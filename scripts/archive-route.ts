/**
 * Soft-delete a route. Archived routes are excluded from search_routes_by_vibe
 * and from the destination index, but the row remains so quality_score history
 * and the curator-authored content are preserved.
 *
 * Run:
 *   npx tsx --env-file=.env.local scripts/archive-route.ts --id <route-uuid>
 *
 * To bring a route back, use promote-route.ts --unarchive.
 */

import { createAdminClient } from "@/lib/db";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const i = argv.indexOf("--id");
  const id = i === -1 || i === argv.length - 1 ? undefined : argv[i + 1];
  if (!id) {
    console.error("Usage: tsx scripts/archive-route.ts --id <route-uuid>");
    process.exit(1);
  }

  const db = createAdminClient();
  const { data, error } = await db
    .from("route_templates")
    .update({ is_archived: true })
    .eq("id", id)
    .select("id, title, destination_name")
    .single();

  if (error) {
    console.error("[archive] update failed:", error.message);
    process.exit(1);
  }
  if (!data) {
    console.error(`[archive] no route found with id=${id}`);
    process.exit(1);
  }

  console.log(`[archive] archived "${data.title}" (${data.destination_name})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

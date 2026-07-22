/**
 * Manually collect social-media trending POIs for one or more destinations.
 * Same pipeline the trending-pois cron runs daily — useful for warming a new
 * destination before a demo or backfilling after the migration lands.
 *
 * Run:
 *   npx tsx --env-file=.env.local scripts/collect-trending-pois.ts \
 *     --destinations "Kyoto, Japan" "Taipei, Taiwan"
 */

import { collectTrendingPois } from "@/services/trending/collector";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const flagIdx = args.indexOf("--destinations");
  if (flagIdx === -1 || flagIdx === args.length - 1) {
    console.error("Usage: tsx scripts/collect-trending-pois.ts --destinations 'City, Country' ...");
    process.exit(1);
  }

  for (const destination of args.slice(flagIdx + 1)) {
    console.log(`[trending] collecting: ${destination}`);
    try {
      const result = await collectTrendingPois(destination);
      console.log(
        `[trending]   discovered=${result.discovered} resolved=${result.resolved} ` +
          `newCorpusRows=${result.newCorpusRows} signals=${result.signalsUpserted}`
      );
      for (const err of result.errors) console.warn(`[trending]   ! ${err}`);
    } catch (err) {
      console.error(`[trending]   failed:`, err);
    }
  }
  console.log("[trending] done");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

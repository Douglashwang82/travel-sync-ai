// ─────────────────────────────────────────────────────────────────────────────
// Japan ski destination detection
//
// The product remains a general-purpose group trip planner; this helper lets
// the parsing extractor, private chat, and trip-generation orchestrator
// inject ski-specific guidance only when the trip destination resolves to one
// of the v1 Japan ski regions.
//
// Detection is intentionally permissive: we match the typed destination
// against the per-region alias set (lowercased prefix/substring), so survey
// answers like "Niseko", "niseko united", "Hokkaido ski", "ニセコ", "二世谷"
// all map to the Niseko region. Prefecture-only answers (e.g. "Nagano")
// match the first region in that prefecture — the orchestrator will still
// retrieve POIs across the whole prefecture via destination_aliases.
// ─────────────────────────────────────────────────────────────────────────────

import { normalizeAliases } from "./destination-aliases";
import { REGIONS, type RegionMeta } from "./ski-ingest";

export type SkiDestinationMatch =
  | { match: false }
  | { match: true; region: RegionMeta };

/**
 * Region-specific tokens only — we deliberately exclude "Japan", "Japan ski",
 * and bare prefecture names here, otherwise a Tokyo trip (a fine, valid
 * generic trip) would falsely trigger ski-mode prompts because "Tokyo, Japan"
 * contains "japan".
 *
 * The orchestrator's POI retrieval still uses the broader alias set on the
 * stored rows (see lib/ski-ingest.ts:regionAliases) so prefecture-level
 * queries continue to surface ski POIs from the corpus; this helper only
 * decides whether to *augment* the LLM prompts.
 */
function strongAliases(meta: RegionMeta): string[] {
  // Deliberately omit the "..., Japan" suffix variant — otherwise a needle of
  // "Japan" would containment-match "niseko, hokkaido, japan" and falsely
  // ski-flag every Japan trip.
  return normalizeAliases([
    meta.region,
    meta.regionZh,
    meta.regionJa,
    meta.slug,
    meta.slug.replace(/-/g, " "),
    `${meta.region} ski`,
    `${meta.region} ski resort`,
    `ski ${meta.region}`,
    `${meta.region}, ${meta.prefecture}`,
  ]);
}

/**
 * Resolve a free-text destination string to one of the v1 ski regions.
 *
 * Returns `{ match: false }` if the destination is null/empty or does not
 * align with any region's strong aliases. Callers should treat a `false`
 * result as "use generic prompts" — never block the request.
 */
export function detectJapanSkiDestination(destination: string | null | undefined): SkiDestinationMatch {
  if (!destination) return { match: false };
  const needle = destination.trim().toLowerCase();
  if (needle.length === 0) return { match: false };

  for (const region of REGIONS) {
    for (const alias of strongAliases(region)) {
      // Only one direction of containment (typed dest contains a strong
      // alias). The reverse would over-match: a short generic needle like
      // "Japan" or "ski" would be a substring of half the alias set.
      if (needle === alias || needle.includes(alias)) {
        return { match: true, region };
      }
    }
  }
  return { match: false };
}

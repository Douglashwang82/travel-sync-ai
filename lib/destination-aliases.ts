// ─────────────────────────────────────────────────────────────────────────────
// Destination alias normalization
//
// The vibe-search RPCs (search_pois_by_vibe, search_routes_by_vibe) compare
// the query against the destination_aliases column as `lower(trim($1)) =
// any(aliases)`. That requires aliases to be stored already-lowercased.
// Everything that writes to those columns goes through this helper.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lowercase + trim + dedupe + drop empties. Order is preserved (first
 * occurrence wins) so callers can ship aliases in priority order if they
 * care to.
 */
export function normalizeAliases(input: Iterable<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    if (raw == null) continue;
    const a = raw.trim().toLowerCase();
    if (a.length === 0 || seen.has(a)) continue;
    seen.add(a);
    out.push(a);
  }
  return out;
}

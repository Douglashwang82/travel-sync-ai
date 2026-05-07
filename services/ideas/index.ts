import { createAdminClient } from "@/lib/db";
import type { Result } from "@/lib/result";
import type { ItemType } from "@/lib/types";

// ─── Types ────────────────────────────────────────────────────────────────────

export type IdeaSortOrder = "recent" | "popular";

export interface SearchIdeasInput {
  q?: string;
  itemTypes?: ItemType[];
  destination?: string;
  sort?: IdeaSortOrder;
  limit?: number;
  offset?: number;
}

export interface IdeaCard {
  id: string;
  title: string;
  notes: string | null;
  itemType: ItemType;
  placeName: string | null;
  address: string | null;
  externalUrl: string | null;
  durationMinutes: number | null;
  destinationName: string;
  templateSlug: string;
  templateTitle: string;
  templateCoverImageUrl: string | null;
  templateLikeCount: number;
  templateForkCount: number;
  authorLineUserId: string;
  authorDisplayName: string | null;
  publishedAt: string;
}

export interface SearchIdeasResult {
  ideas: IdeaCard[];
  hasMore: boolean;
  nextOffset: number;
}

interface CurrentVersionRow {
  versionId: string;
  templateId: string;
  templateSlug: string;
  authorLineUserId: string;
  likeCount: number;
  forkCount: number;
  versionTitle: string;
  destinationName: string;
  coverImageUrl: string | null;
  publishedAt: string;
}

/**
 * Loads metadata about every CURRENT version of every public, non-deleted
 * template, optionally filtered by destination. Used as the joinable index
 * for ideas search — keeping it as a separate query avoids the Supabase JS
 * limitation that prevents comparing two columns in a single filter.
 */
async function loadPublicCurrentVersions(
  destination: string | undefined
): Promise<CurrentVersionRow[]> {
  const db = createAdminClient();

  const { data, error } = await db
    .from("trip_templates")
    .select(
      `
        id,
        slug,
        author_line_user_id,
        like_count,
        fork_count,
        current_version_id,
        trip_template_versions!trip_templates_current_version_id_fkey (
          id,
          title,
          destination_name,
          cover_image_url,
          published_at
        )
      `
    )
    .eq("visibility", "public")
    .is("deleted_at", null)
    .not("current_version_id", "is", null);
  if (error || !data) return [];

  type Row = {
    id: string;
    slug: string;
    author_line_user_id: string;
    like_count: number;
    fork_count: number;
    current_version_id: string | null;
    trip_template_versions: {
      id: string;
      title: string;
      destination_name: string;
      cover_image_url: string | null;
      published_at: string;
    } | null;
  };

  const rows = data as unknown as Row[];
  const out: CurrentVersionRow[] = [];
  const destNeedle = destination?.trim().toLowerCase();
  for (const r of rows) {
    const v = r.trip_template_versions;
    if (!v) continue;
    if (destNeedle && !v.destination_name.toLowerCase().includes(destNeedle)) continue;
    out.push({
      versionId: v.id,
      templateId: r.id,
      templateSlug: r.slug,
      authorLineUserId: r.author_line_user_id,
      likeCount: r.like_count,
      forkCount: r.fork_count,
      versionTitle: v.title,
      destinationName: v.destination_name,
      coverImageUrl: v.cover_image_url,
      publishedAt: v.published_at,
    });
  }
  return out;
}

// ─── Public discovery search ──────────────────────────────────────────────────

/**
 * Surfaces individual trip-template items from PUBLIC templates as discrete
 * "ideas" — discoverable nuggets (a restaurant, a hike, a hotel) without the
 * commitment of forking an entire itinerary.
 *
 * Scope: only items that belong to the *current* version of a public,
 * non-deleted template are returned. Private and request_only templates are
 * intentionally excluded — the Ideas surface is a public-first discovery feed.
 */
export async function searchIdeas(
  input: SearchIdeasInput
): Promise<Result<SearchIdeasResult>> {
  const db = createAdminClient();
  const limit = Math.min(Math.max(input.limit ?? 24, 1), 60);
  const offset = Math.max(input.offset ?? 0, 0);

  const versions = await loadPublicCurrentVersions(input.destination);
  if (versions.length === 0) {
    return { ok: true, data: { ideas: [], hasMore: false, nextOffset: offset } };
  }

  const versionIds = versions.map((v) => v.versionId);
  const versionMap = new Map<string, CurrentVersionRow>(
    versions.map((v) => [v.versionId, v])
  );

  let itemQuery = db
    .from("trip_template_items")
    .select(
      "id, version_id, item_type, title, notes, place_name, address, external_url, duration_minutes"
    )
    .in("version_id", versionIds);

  if (input.itemTypes && input.itemTypes.length > 0) {
    itemQuery = itemQuery.in("item_type", input.itemTypes);
  }

  if (input.q && input.q.trim()) {
    const term = `%${input.q.trim()}%`;
    itemQuery = itemQuery.or(
      `title.ilike.${term},place_name.ilike.${term},notes.ilike.${term}`
    );
  }

  // Sorting strategy:
  //  - recent  → newest publish first (item table doesn't carry published_at,
  //              so we sort in JS once we've joined version metadata).
  //  - popular → parent template like_count desc (also resolved in JS).
  // We over-fetch a generous slice from Supabase and finish ranking in
  // memory; safe given small result sets in the early product.
  const FETCH_CAP = 240;
  const { data: itemRows, error } = await itemQuery.limit(FETCH_CAP);
  if (error) {
    return { ok: false, error: "Failed to load ideas", code: "DB_ERROR" };
  }

  type ItemRow = {
    id: string;
    version_id: string;
    item_type: ItemType;
    title: string;
    notes: string | null;
    place_name: string | null;
    address: string | null;
    external_url: string | null;
    duration_minutes: number | null;
  };

  const items = (itemRows ?? []) as ItemRow[];

  const sortMode: IdeaSortOrder = input.sort === "popular" ? "popular" : "recent";
  const enriched = items
    .map((it) => {
      const v = versionMap.get(it.version_id);
      if (!v) return null;
      return { it, v };
    })
    .filter((x): x is { it: ItemRow; v: CurrentVersionRow } => x !== null);

  enriched.sort((a, b) => {
    if (sortMode === "popular") {
      const diff = b.v.likeCount - a.v.likeCount;
      if (diff !== 0) return diff;
    }
    // Tie-breaker (and primary key for "recent"): newer publish first
    return b.v.publishedAt.localeCompare(a.v.publishedAt);
  });

  const total = enriched.length;
  const page = enriched.slice(offset, offset + limit);
  const hasMore = offset + page.length < total;

  // Resolve author display names in a single batched lookup
  const authorIds = Array.from(new Set(page.map(({ v }) => v.authorLineUserId)));
  const nameMap: Record<string, string | null> = {};
  if (authorIds.length > 0) {
    const { data: members } = await db
      .from("group_members")
      .select("line_user_id, display_name")
      .in("line_user_id", authorIds)
      .is("left_at", null);
    for (const m of members ?? []) {
      const uid = m.line_user_id as string;
      if (!(uid in nameMap)) {
        nameMap[uid] = (m.display_name as string | null) ?? null;
      }
    }
  }

  const ideas: IdeaCard[] = page.map(({ it, v }) => ({
    id: it.id,
    title: it.title,
    notes: it.notes,
    itemType: it.item_type,
    placeName: it.place_name,
    address: it.address,
    externalUrl: it.external_url,
    durationMinutes: it.duration_minutes,
    destinationName: v.destinationName,
    templateSlug: v.templateSlug,
    templateTitle: v.versionTitle,
    templateCoverImageUrl: v.coverImageUrl,
    templateLikeCount: v.likeCount,
    templateForkCount: v.forkCount,
    authorLineUserId: v.authorLineUserId,
    authorDisplayName: nameMap[v.authorLineUserId] ?? null,
    publishedAt: v.publishedAt,
  }));

  return {
    ok: true,
    data: { ideas, hasMore, nextOffset: offset + page.length },
  };
}

// ─── Destination autocomplete ────────────────────────────────────────────────

/**
 * Returns the most prolific public destinations so the Ideas page can offer
 * one-tap filter chips. Capped to 12 entries — beyond that the chip row gets
 * unwieldy and users should fall back to free-text destination search.
 */
export async function listPopularDestinations(): Promise<
  Result<{ destinations: { name: string; ideaCount: number }[] }>
> {
  const versions = await loadPublicCurrentVersions(undefined);

  if (versions.length === 0) {
    return { ok: true, data: { destinations: [] } };
  }

  // Count items per destination so chips reflect actual idea volume, not just
  // template count (a template with 30 items is more valuable here than ten
  // empty templates from the same city).
  const versionIds = versions.map((v) => v.versionId);
  const versionToDest = new Map<string, string>(
    versions.map((v) => [v.versionId, v.destinationName])
  );

  const db = createAdminClient();
  const { data: items, error } = await db
    .from("trip_template_items")
    .select("version_id")
    .in("version_id", versionIds);

  if (error) {
    return { ok: false, error: "Failed to load destinations", code: "DB_ERROR" };
  }

  const counts = new Map<string, number>();
  for (const row of items ?? []) {
    const dest = versionToDest.get(row.version_id as string);
    if (!dest) continue;
    const key = dest.trim();
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const destinations = Array.from(counts.entries())
    .map(([name, ideaCount]) => ({ name, ideaCount }))
    .sort((a, b) => b.ideaCount - a.ideaCount)
    .slice(0, 12);

  return { ok: true, data: { destinations } };
}

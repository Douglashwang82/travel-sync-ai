// ─────────────────────────────────────────────────────────────────────────────
// POI curation — taxonomy, patch validation, and the heuristic categorizer
// behind the admin console's label/categorize workflow.
//
// Curation fields live on poi_embeddings but are metadata-only: none of them
// feed the embedding description, so editing them never triggers re-embedding.
// They ARE actionable elsewhere — curation_status='hidden' removes a POI from
// vibe retrieval (search_pois_by_vibe) and the index-page trending wall, and
// category / labels / quality_score are stable features a ranking algorithm
// can consume next to the itinerary_feedback aggregates.
// ─────────────────────────────────────────────────────────────────────────────

export const POI_CATEGORIES = [
  "landmark",
  "culture",
  "nature",
  "food",
  "museum",
  "nightlife",
  "shopping",
  "wellness",
  "other",
] as const;
export type PoiCategory = (typeof POI_CATEGORIES)[number];

export const CURATION_STATUSES = ["unreviewed", "approved", "hidden"] as const;
export type CurationStatus = (typeof CURATION_STATUSES)[number];

export interface CurationPatch {
  category?: PoiCategory | null;
  labels?: string[];
  curation_status?: CurationStatus;
  quality_score?: number | null;
  curation_notes?: string | null;
}

/**
 * Validate the curation subset of an admin PATCH body. Only keys present in
 * `raw` end up in the patch, so callers can merge it with the existing
 * metadata-only patch without clobbering untouched fields.
 */
export function validateCurationPatch(
  raw: Record<string, unknown>
): { ok: true; value: CurationPatch } | { ok: false; error: string } {
  const patch: CurationPatch = {};

  if ("category" in raw) {
    if (raw.category === null) patch.category = null;
    else if (typeof raw.category === "string" && POI_CATEGORIES.includes(raw.category as PoiCategory)) {
      patch.category = raw.category as PoiCategory;
    } else {
      return { ok: false, error: `category must be null or one of ${POI_CATEGORIES.join(", ")}` };
    }
  }

  if ("labels" in raw) {
    if (!Array.isArray(raw.labels)) return { ok: false, error: "labels must be an array of strings" };
    patch.labels = Array.from(
      new Set(
        raw.labels
          .filter((l): l is string => typeof l === "string")
          .map((l) => l.trim().toLowerCase().replace(/\s+/g, "_"))
          .filter((l) => l.length > 0)
      )
    ).slice(0, 24);
  }

  if ("curation_status" in raw) {
    if (typeof raw.curation_status !== "string" || !CURATION_STATUSES.includes(raw.curation_status as CurationStatus)) {
      return { ok: false, error: `curation_status must be one of ${CURATION_STATUSES.join(", ")}` };
    }
    patch.curation_status = raw.curation_status as CurationStatus;
  }

  if ("quality_score" in raw) {
    if (raw.quality_score === null) patch.quality_score = null;
    else if (typeof raw.quality_score === "number" && Number.isFinite(raw.quality_score) && raw.quality_score >= 0 && raw.quality_score <= 1) {
      patch.quality_score = raw.quality_score;
    } else {
      return { ok: false, error: "quality_score must be null or a number in [0,1]" };
    }
  }

  if ("curation_notes" in raw) {
    if (raw.curation_notes === null) patch.curation_notes = null;
    else if (typeof raw.curation_notes === "string") patch.curation_notes = raw.curation_notes.slice(0, 2000);
    else return { ok: false, error: "curation_notes must be null or a string" };
  }

  return { ok: true, value: patch };
}

// ─── Heuristic categorizer ────────────────────────────────────────────────────

const CATEGORY_KEYWORDS: Array<{ category: PoiCategory; keywords: string[] }> = [
  { category: "museum", keywords: ["museum", "gallery", "art", "exhibition"] },
  { category: "nature", keywords: ["park", "nature", "hike", "hiking", "mountain", "beach", "garden", "lake", "trail", "viewpoint", "ski_resort", "ski"] },
  { category: "wellness", keywords: ["onsen", "spa", "hot_spring", "wellness", "sauna", "massage"] },
  { category: "nightlife", keywords: ["bar", "nightlife", "club", "izakaya", "pub", "sake"] },
  { category: "shopping", keywords: ["shopping", "market", "mall", "shop", "store", "boutique", "vending"] },
  { category: "culture", keywords: ["temple", "shrine", "culture", "heritage", "castle", "historic", "traditional", "festival"] },
];

/**
 * Suggest a category from what the corpus already knows about a POI. Not an
 * LLM: deterministic keyword mapping over item_type, tags and the name so a
 * bulk pass over hundreds of rows is instant and repeatable. Restaurants are
 * always food; unmatched activities default to landmark; hotels/transport get
 * "other" (they are logistics, not sights).
 */
export function suggestCategory(itemType: string, tags: string[], name = ""): PoiCategory {
  if (itemType === "restaurant") return "food";
  if (itemType === "hotel" || itemType === "transport") return "other";

  const haystack = new Set(tags.map((t) => t.trim().toLowerCase()));
  const nameWords = name.toLowerCase();
  for (const { category, keywords } of CATEGORY_KEYWORDS) {
    if (keywords.some((k) => haystack.has(k) || nameWords.includes(k.replace(/_/g, " ")))) {
      return category;
    }
  }
  // Food places sometimes arrive typed as activity (cafés, food tours).
  if (["cafe", "coffee", "food", "ramen", "dessert", "bakery"].some((k) => haystack.has(k) || nameWords.includes(k))) {
    return "food";
  }
  return itemType === "activity" ? "landmark" : "other";
}

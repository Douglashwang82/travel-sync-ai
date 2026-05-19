import { createAdminClient } from "@/lib/db";
import { generateEmbedding } from "@/lib/gemini";

export const POI_ITEM_TYPES = ["hotel", "restaurant", "activity", "transport", "other"] as const;
export type PoiItemType = (typeof POI_ITEM_TYPES)[number];

export interface PoiInput {
  place_id: string;
  destination_name: string;
  destination_aliases?: string[];
  name: string;
  item_type: PoiItemType;
  tags?: string[];
  description?: string;
  lat?: number | null;
  lng?: number | null;
  source?: string;
}

export interface PoiUpsertResult {
  place_id: string;
  ok: boolean;
  error?: string;
}

function normalizeAliases(aliases: unknown): string[] {
  if (!Array.isArray(aliases)) return [];
  const seen = new Set<string>();
  for (const a of aliases) {
    if (typeof a !== "string") continue;
    const trimmed = a.trim().toLowerCase();
    if (trimmed.length > 0) seen.add(trimmed);
  }
  return Array.from(seen);
}

function normalizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  const seen = new Set<string>();
  for (const t of tags) {
    if (typeof t !== "string") continue;
    const trimmed = t.trim().toLowerCase().replace(/\s+/g, "_");
    if (trimmed.length > 0) seen.add(trimmed);
  }
  return Array.from(seen).slice(0, 16);
}

export function validatePoiInput(raw: unknown): { ok: true; value: PoiInput } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") return { ok: false, error: "must be an object" };
  const r = raw as Record<string, unknown>;

  const place_id = typeof r.place_id === "string" ? r.place_id.trim() : "";
  if (!place_id) return { ok: false, error: "place_id required" };

  const destination_name = typeof r.destination_name === "string" ? r.destination_name.trim() : "";
  if (!destination_name) return { ok: false, error: "destination_name required" };

  const name = typeof r.name === "string" ? r.name.trim() : "";
  if (!name) return { ok: false, error: "name required" };

  const item_type = r.item_type as string;
  if (!POI_ITEM_TYPES.includes(item_type as PoiItemType)) {
    return { ok: false, error: `item_type must be one of ${POI_ITEM_TYPES.join(", ")}` };
  }

  const lat = r.lat == null ? null : typeof r.lat === "number" && Number.isFinite(r.lat) ? r.lat : null;
  const lng = r.lng == null ? null : typeof r.lng === "number" && Number.isFinite(r.lng) ? r.lng : null;

  return {
    ok: true,
    value: {
      place_id,
      destination_name,
      destination_aliases: normalizeAliases(r.destination_aliases),
      name,
      item_type: item_type as PoiItemType,
      tags: normalizeTags(r.tags),
      description: typeof r.description === "string" ? r.description : "",
      lat,
      lng,
      source: typeof r.source === "string" && r.source.trim().length > 0 ? r.source : "admin_upload",
    },
  };
}

function buildDescription(input: PoiInput): string {
  if (input.description && input.description.trim().length > 0) return input.description;
  const tags = input.tags ?? [];
  return [input.name, `${input.item_type} in ${input.destination_name}`, tags.length > 0 ? `tags: ${tags.join(", ")}` : null]
    .filter(Boolean)
    .join(" | ");
}

export async function upsertPoi(input: PoiInput): Promise<PoiUpsertResult> {
  try {
    const description = buildDescription(input);
    const embedding = await generateEmbedding(description);
    const db = createAdminClient();
    const now = new Date().toISOString();

    const { error } = await db.from("poi_embeddings").upsert(
      {
        place_id: input.place_id,
        destination_name: input.destination_name,
        destination_aliases: input.destination_aliases ?? [],
        name: input.name,
        item_type: input.item_type,
        tags: input.tags ?? [],
        description,
        embedding,
        lat: input.lat ?? null,
        lng: input.lng ?? null,
        source: input.source ?? "admin_upload",
        last_seen_at: now,
      },
      { onConflict: "place_id" }
    );
    if (error) return { place_id: input.place_id, ok: false, error: error.message };

    await db.from("place_details_cache").upsert(
      {
        place_id: input.place_id,
        payload: {
          placeId: input.place_id,
          name: input.name,
          address: null,
          rating: null,
          priceLevel: null,
          lat: input.lat ?? null,
          lng: input.lng ?? null,
          openingPeriods: [],
        },
        fetched_at: now,
      },
      { onConflict: "place_id" }
    );

    return { place_id: input.place_id, ok: true };
  } catch (err) {
    return {
      place_id: input.place_id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function bulkUpsertPois(items: unknown[]): Promise<{
  total: number;
  succeeded: number;
  failed: number;
  results: PoiUpsertResult[];
}> {
  const results: PoiUpsertResult[] = [];
  for (const raw of items) {
    const validated = validatePoiInput(raw);
    if (!validated.ok) {
      const placeId = (raw as { place_id?: unknown })?.place_id;
      results.push({
        place_id: typeof placeId === "string" ? placeId : "(invalid)",
        ok: false,
        error: validated.error,
      });
      continue;
    }
    results.push(await upsertPoi(validated.value));
  }
  const succeeded = results.filter((r) => r.ok).length;
  return { total: results.length, succeeded, failed: results.length - succeeded, results };
}

export function parseCsvRows(csv: string): Record<string, string>[] {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const header = splitCsvLine(lines[0]).map((h) => h.trim());
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const row: Record<string, string> = {};
    for (let j = 0; j < header.length; j++) {
      row[header[j]] = (cells[j] ?? "").trim();
    }
    rows.push(row);
  }
  return rows;
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      cells.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  cells.push(current);
  return cells;
}

export function csvRowToPoiInput(row: Record<string, string>): unknown {
  const aliases = row.destination_aliases
    ? row.destination_aliases.split(/[|;]/).map((s) => s.trim()).filter(Boolean)
    : [];
  const tags = row.tags ? row.tags.split(/[|;]/).map((s) => s.trim()).filter(Boolean) : [];
  const latNum = row.lat ? Number(row.lat) : NaN;
  const lngNum = row.lng ? Number(row.lng) : NaN;
  return {
    place_id: row.place_id,
    destination_name: row.destination_name,
    destination_aliases: aliases,
    name: row.name,
    item_type: row.item_type,
    tags,
    description: row.description ?? "",
    lat: Number.isFinite(latNum) ? latNum : null,
    lng: Number.isFinite(lngNum) ? lngNum : null,
    source: row.source ?? "admin_upload",
  };
}

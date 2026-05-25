// ─────────────────────────────────────────────────────────────────────────────
// Japan ski region ingester — pure transforms
//
// Per-region bundles under data/japan-ski-trip/{region}/ ship five JSON files
// (resorts, hotels, restaurants, activities, transport) with stable but
// distinct shapes. This module turns those into poi_embeddings-shaped rows.
// Side-effects (DB writes, embedding RPC calls) live in
// scripts/ingest-ski-regions.ts; everything here is deterministic and unit
// tested.
// ─────────────────────────────────────────────────────────────────────────────

import { normalizeAliases } from "./destination-aliases";

// ─── Per-region metadata ─────────────────────────────────────────────────────
// Region slug = directory name under data/japan-ski-trip/. Region name = the
// `region` field inside each JSON (used as the canonical destination_name).

export interface RegionMeta {
  slug: string;
  region: string;
  regionZh: string;
  regionJa: string;
  prefecture: string;
  prefectureZh: string;
}

export const REGIONS: RegionMeta[] = [
  { slug: "niseko",       region: "Niseko",       regionZh: "二世谷",     regionJa: "ニセコ",       prefecture: "Hokkaido", prefectureZh: "北海道" },
  { slug: "hakuba",       region: "Hakuba",       regionZh: "白馬",       regionJa: "白馬",         prefecture: "Nagano",   prefectureZh: "長野" },
  { slug: "naeba",        region: "Naeba",        regionZh: "苗場",       regionJa: "苗場",         prefecture: "Niigata",  prefectureZh: "新潟" },
  { slug: "nozawa-onsen", region: "Nozawa Onsen", regionZh: "野澤溫泉",   regionJa: "野沢温泉",     prefecture: "Nagano",   prefectureZh: "長野" },
  { slug: "shiga-kogen",  region: "Shiga Kogen",  regionZh: "志賀高原",   regionJa: "志賀高原",     prefecture: "Nagano",   prefectureZh: "長野" },
  { slug: "zao-onsen",    region: "Zao Onsen",    regionZh: "藏王溫泉",   regionJa: "蔵王温泉",     prefecture: "Yamagata", prefectureZh: "山形" },
];

// ─── Input shapes ────────────────────────────────────────────────────────────

export interface ResortRow {
  id: string;
  name: string;
  name_ja?: string;
  part_of?: string;
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
  website?: string | null;
  lifts?: number | null;
  courses?: number | null;
  vertical_m?: number | null;
  longest_run_m?: number | null;
  top_elevation_m?: number | null;
  base_elevation_m?: number | null;
  night_skiing?: boolean;
  notes?: string;
}

export interface HotelRow {
  id: string;
  name: string;
  category?: string;
  price_band?: string;
  base_resort?: string;
  ski_in_ski_out?: boolean;
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
  website?: string | null;
  amenities?: string[];
  notes?: string;
}

export interface RestaurantRow {
  id: string;
  name: string;
  cuisine?: string;
  price_band?: string;
  village?: string;
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
  website?: string | null;
  reservation_required?: boolean;
  notes?: string;
}

export interface ActivityRow {
  id: string;
  name: string;
  type?: string;
  village?: string;
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
  website?: string | null;
  notes?: string;
}

export interface TransportRow {
  id: string;
  name: string;
  name_ja?: string;
  type?: string;
  lat?: number | null;
  lng?: number | null;
  website?: string | null;
  notes?: string;
}

// ─── Output shape (subset of poi_embeddings columns) ─────────────────────────

export interface PoiUpsert {
  place_id: string;
  destination_name: string;
  destination_aliases: string[];
  name: string;
  item_type: "hotel" | "restaurant" | "activity" | "transport" | "other";
  tags: string[];
  description: string;
  lat: number | null;
  lng: number | null;
  /** Source-of-truth column for curated rows lacking a Google place_id. */
  live_data: {
    placeId: string;
    name: string | null;
    address: string | null;
    rating: null;
    priceLevel: null;
    lat: number | null;
    lng: number | null;
    /** Opening hours intentionally left empty — ski/onsen hours drift seasonally. */
    openingPeriods: never[];
  };
  source: string;
  /** Embedding source text; the script generates the vector before upsert. */
  embedText: string;
}

// ─── Aliases ─────────────────────────────────────────────────────────────────

export function regionAliases(meta: RegionMeta): string[] {
  return normalizeAliases([
    meta.region,
    meta.regionZh,
    meta.regionJa,
    meta.slug,
    meta.slug.replace(/-/g, " "),
    meta.prefecture,
    meta.prefectureZh,
    `${meta.prefecture}, Japan`,
    `${meta.region}, ${meta.prefecture}`,
    `${meta.region}, ${meta.prefecture}, Japan`,
    `${meta.region} ski`,
    `${meta.region} ski resort`,
    `ski ${meta.region}`,
    "Japan",
    "Japan ski",
    "Japan ski trip",
    "Japan snow",
    "ski japan",
  ]);
}

// ─── Tag derivation (maps ski-domain attrs to existing vibe vocabulary) ──────

const VIBE_BASE = ["ski", "snow", "winter"];

export function resortTags(r: ResortRow): string[] {
  const tags = new Set<string>([...VIBE_BASE, "ski_resort", "adventure", "nature"]);
  if (r.night_skiing) {
    tags.add("night_skiing");
    tags.add("nightlife");
  }
  return Array.from(tags);
}

export function hotelTags(h: HotelRow): string[] {
  const tags = new Set<string>(["ski_lodging"]);
  for (const a of h.amenities ?? []) {
    if (a === "onsen") {
      tags.add("onsen");
      tags.add("relaxed");
    } else if (a === "ski_valet" || a === "ski_storage") {
      tags.add("ski_in_ski_out_adjacent");
    } else if (a === "kids_program" || a === "family_room") {
      tags.add("family");
    } else if (a === "spa") {
      tags.add("relaxed");
    } else if (a === "fine_dining") {
      tags.add("foodie");
    }
  }
  if (h.ski_in_ski_out) tags.add("ski_in_ski_out");
  if (h.category === "luxury" || h.price_band === "$$$$") tags.add("luxury");
  if (h.price_band === "$" || h.category === "budget") tags.add("budget");
  return Array.from(tags);
}

export function restaurantTags(r: RestaurantRow): string[] {
  const tags = new Set<string>(["foodie"]);
  if (r.cuisine) tags.add(r.cuisine.toLowerCase());
  if (r.price_band === "$$$$" || r.price_band === "$$$") tags.add("fine_dining");
  if (r.price_band === "$") tags.add("budget");
  if (r.reservation_required) tags.add("reservation_required");
  return Array.from(tags);
}

export function activityTags(a: ActivityRow): string[] {
  const tags = new Set<string>();
  const t = (a.type ?? "").toLowerCase();
  if (t === "onsen") {
    tags.add("onsen");
    tags.add("relaxed");
  } else if (t === "snow_activity" || t === "snow_play" || t === "night_tubing") {
    tags.add("snow_activity");
    tags.add("adventure");
    tags.add("family");
  } else if (t === "sightseeing" || t === "viewpoint") {
    tags.add("sightseeing");
    tags.add("culture");
  } else if (t === "culture" || t === "shrine" || t === "temple") {
    tags.add("culture");
  } else if (t === "nightlife" || t === "bar") {
    tags.add("nightlife");
  } else if (t) {
    tags.add(t);
  }
  return tags.size === 0 ? ["activity"] : Array.from(tags);
}

export function transportTags(t: TransportRow): string[] {
  const tags = new Set<string>(["transport"]);
  const type = (t.type ?? "").toLowerCase();
  if (type) tags.add(type);
  if (type.includes("airport")) tags.add("gateway");
  if (type.includes("station")) tags.add("gateway");
  return Array.from(tags);
}

// ─── Embedding source text (mirrors poi-engine query shape) ──────────────────

export function resortEmbedText(r: ResortRow, meta: RegionMeta): string {
  const facilities = [
    r.lifts != null ? `${r.lifts} lifts` : null,
    r.courses != null ? `${r.courses} courses` : null,
    r.vertical_m != null ? `${r.vertical_m}m vertical` : null,
    r.night_skiing ? "night skiing" : null,
  ].filter(Boolean).join(", ");
  const partOf = r.part_of ? ` (${r.part_of})` : "";
  return `Ski resort in ${meta.region}, ${meta.prefecture}, Japan. ${r.name}${partOf}. ${facilities}. ${r.notes ?? ""}`.trim();
}

export function hotelEmbedText(h: HotelRow, meta: RegionMeta): string {
  const amenities = (h.amenities ?? []).join(", ");
  const sio = h.ski_in_ski_out ? "Ski-in/ski-out. " : "";
  return `Ski-trip ${h.category ?? "hotel"} in ${meta.region}, ${meta.prefecture}, Japan. ${h.name}. ${sio}Amenities: ${amenities}. ${h.notes ?? ""}`.trim();
}

export function restaurantEmbedText(r: RestaurantRow, meta: RegionMeta): string {
  const village = r.village ? ` (${r.village})` : "";
  return `Restaurant in ${meta.region}, ${meta.prefecture}, Japan${village}. ${r.name}. ${r.cuisine ?? ""} ${r.price_band ?? ""}. ${r.notes ?? ""}`.trim();
}

export function activityEmbedText(a: ActivityRow, meta: RegionMeta): string {
  const village = a.village ? ` (${a.village})` : "";
  return `${a.type ?? "Activity"} in ${meta.region}, ${meta.prefecture}, Japan${village}. ${a.name}. ${a.notes ?? ""}`.trim();
}

export function transportEmbedText(t: TransportRow, meta: RegionMeta): string {
  return `Transport gateway for ${meta.region}, ${meta.prefecture}, Japan. ${t.name} (${t.type ?? "gateway"}). ${t.notes ?? ""}`.trim();
}

// ─── Row builders ────────────────────────────────────────────────────────────

const SOURCE = "curated:japan-ski-region";

function liveData(id: string, name: string, address: string | null, lat: number | null, lng: number | null): PoiUpsert["live_data"] {
  return {
    placeId: id,
    name,
    address,
    rating: null,
    priceLevel: null,
    lat,
    lng,
    openingPeriods: [],
  };
}

export function buildResortRow(r: ResortRow, meta: RegionMeta): PoiUpsert {
  return {
    place_id: r.id,
    destination_name: meta.region,
    destination_aliases: normalizeAliases([...regionAliases(meta), r.id, r.name, r.name_ja ?? null, r.part_of ?? null]),
    name: r.name,
    item_type: "activity",
    tags: resortTags(r),
    description: r.notes ?? r.name,
    lat: r.lat ?? null,
    lng: r.lng ?? null,
    live_data: liveData(r.id, r.name, r.address ?? null, r.lat ?? null, r.lng ?? null),
    source: SOURCE,
    embedText: resortEmbedText(r, meta),
  };
}

export function buildHotelRow(h: HotelRow, meta: RegionMeta): PoiUpsert {
  return {
    place_id: h.id,
    destination_name: meta.region,
    destination_aliases: normalizeAliases([...regionAliases(meta), h.id, h.name]),
    name: h.name,
    item_type: "hotel",
    tags: hotelTags(h),
    description: h.notes ?? h.name,
    lat: h.lat ?? null,
    lng: h.lng ?? null,
    live_data: liveData(h.id, h.name, h.address ?? null, h.lat ?? null, h.lng ?? null),
    source: SOURCE,
    embedText: hotelEmbedText(h, meta),
  };
}

export function buildRestaurantRow(r: RestaurantRow, meta: RegionMeta): PoiUpsert {
  return {
    place_id: r.id,
    destination_name: meta.region,
    destination_aliases: normalizeAliases([...regionAliases(meta), r.id, r.name]),
    name: r.name,
    item_type: "restaurant",
    tags: restaurantTags(r),
    description: r.notes ?? r.name,
    lat: r.lat ?? null,
    lng: r.lng ?? null,
    live_data: liveData(r.id, r.name, r.address ?? null, r.lat ?? null, r.lng ?? null),
    source: SOURCE,
    embedText: restaurantEmbedText(r, meta),
  };
}

export function buildActivityRow(a: ActivityRow, meta: RegionMeta): PoiUpsert {
  return {
    place_id: a.id,
    destination_name: meta.region,
    destination_aliases: normalizeAliases([...regionAliases(meta), a.id, a.name]),
    name: a.name,
    item_type: "activity",
    tags: activityTags(a),
    description: a.notes ?? a.name,
    lat: a.lat ?? null,
    lng: a.lng ?? null,
    live_data: liveData(a.id, a.name, a.address ?? null, a.lat ?? null, a.lng ?? null),
    source: SOURCE,
    embedText: activityEmbedText(a, meta),
  };
}

export function buildTransportRow(t: TransportRow, meta: RegionMeta): PoiUpsert {
  return {
    place_id: t.id,
    destination_name: meta.region,
    destination_aliases: normalizeAliases([...regionAliases(meta), t.id, t.name, t.name_ja ?? null]),
    name: t.name,
    item_type: "transport",
    tags: transportTags(t),
    description: t.notes ?? t.name,
    lat: t.lat ?? null,
    lng: t.lng ?? null,
    live_data: liveData(t.id, t.name, null, t.lat ?? null, t.lng ?? null),
    source: SOURCE,
    embedText: transportEmbedText(t, meta),
  };
}

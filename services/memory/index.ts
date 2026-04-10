import { createAdminClient } from "@/lib/db";
import type { ItemType } from "@/lib/types";

export interface PlaceMemoryInput {
  tripId: string;
  groupId: string;
  itemType: ItemType;
  title: string;
  summary?: string | null;
  address?: string | null;
  rating?: number | null;
  priceLevel?: string | null;
  imageUrl?: string | null;
  bookingUrl?: string | null;
  sourceLineUserId?: string;
  sourceEventId?: string;
}

export interface PlaceMemory {
  id: string;
  trip_id: string;
  group_id: string;
  item_type: ItemType;
  title: string;
  canonical_key: string;
  summary: string | null;
  address: string | null;
  rating: number | null;
  price_level: string | null;
  image_url: string | null;
  booking_url: string | null;
  mention_count: number;
  source_line_user_id: string | null;
  source_event_id: string | null;
  created_at: string;
  last_mentioned_at: string;
  updated_at: string;
}

export interface Recommendation {
  title: string;
  score: number;
  summary: string | null;
  address: string | null;
  rating: number | null;
  priceLevel: string | null;
  bookingUrl: string | null;
  mentionCount: number;
}

export interface PlaceKnowledge {
  id: string;
  title: string;
  summary: string | null;
  address: string | null;
  rating: number | null;
  priceLevel: string | null;
  imageUrl: string | null;
  bookingUrl: string | null;
  mentionCount: number;
}

export async function rememberPlace(input: PlaceMemoryInput): Promise<PlaceMemory | null> {
  const db = createAdminClient();
  const canonicalKey = buildCanonicalKey(input.title, input.bookingUrl);
  const now = new Date().toISOString();

  const { data: existing } = await db
    .from("trip_memories")
    .select("*")
    .eq("trip_id", input.tripId)
    .eq("item_type", input.itemType)
    .eq("canonical_key", canonicalKey)
    .single();

  if (existing) {
    const patch = {
      summary: input.summary ?? existing.summary ?? null,
      address: input.address ?? existing.address ?? null,
      rating: input.rating ?? existing.rating ?? null,
      price_level: input.priceLevel ?? existing.price_level ?? null,
      image_url: input.imageUrl ?? existing.image_url ?? null,
      booking_url: input.bookingUrl ?? existing.booking_url ?? null,
      source_line_user_id: input.sourceLineUserId ?? existing.source_line_user_id ?? null,
      source_event_id: input.sourceEventId ?? existing.source_event_id ?? null,
      mention_count: Number(existing.mention_count ?? 0) + 1,
      last_mentioned_at: now,
    };

    const { data: updated } = await db
      .from("trip_memories")
      .update(patch)
      .eq("id", existing.id)
      .select("*")
      .single();

    return (updated ?? { ...existing, ...patch }) as PlaceMemory;
  }

  const { data: created } = await db
    .from("trip_memories")
    .insert({
      trip_id: input.tripId,
      group_id: input.groupId,
      item_type: input.itemType,
      title: input.title,
      canonical_key: canonicalKey,
      summary: input.summary ?? null,
      address: input.address ?? null,
      rating: input.rating ?? null,
      price_level: input.priceLevel ?? null,
      image_url: input.imageUrl ?? null,
      booking_url: input.bookingUrl ?? null,
      source_line_user_id: input.sourceLineUserId ?? null,
      source_event_id: input.sourceEventId ?? null,
      mention_count: 1,
      last_mentioned_at: now,
    })
    .select("*")
    .single();

  if (!created) return null;

  return created as PlaceMemory;
}

export async function getRecommendations(
  tripId: string,
  itemType: ItemType,
  query?: string
): Promise<Recommendation[]> {
  const db = createAdminClient();
  const { data } = await db
    .from("trip_memories")
    .select("*")
    .eq("trip_id", tripId)
    .eq("item_type", itemType);

  const normalizedQuery = normalizeQuery(query);
  return ((data ?? []) as PlaceMemory[])
    .filter((entry) => matchesQuery(entry, normalizedQuery))
    .map((entry) => ({
      title: entry.title,
      score: buildRecommendationScore(entry),
      summary: entry.summary,
      address: entry.address,
      rating: entry.rating,
      priceLevel: entry.price_level,
      bookingUrl: entry.booking_url,
      mentionCount: entry.mention_count,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

export async function getMemoryHints(
  tripId: string,
  limit = 8
): Promise<string[]> {
  const db = createAdminClient();
  const { data } = await db
    .from("trip_memories")
    .select("title, item_type, mention_count")
    .eq("trip_id", tripId);

  return (data ?? [])
    .sort((a, b) => Number(b.mention_count ?? 0) - Number(a.mention_count ?? 0))
    .slice(0, limit)
    .map((entry) => `${entry.item_type}:${entry.title}`);
}

export async function getKnowledgeEntries(
  tripId: string,
  itemType: ItemType,
  query?: string,
  limit = 10
): Promise<PlaceKnowledge[]> {
  const db = createAdminClient();
  const { data } = await db
    .from("trip_memories")
    .select("*")
    .eq("trip_id", tripId)
    .eq("item_type", itemType);

  const normalizedQuery = normalizeQuery(query);
  return ((data ?? []) as PlaceMemory[])
    .filter((entry) => matchesQuery(entry, normalizedQuery))
    .sort((a, b) => buildRecommendationScore(b) - buildRecommendationScore(a))
    .slice(0, limit)
    .map((entry) => ({
      id: entry.id,
      title: entry.title,
      summary: entry.summary,
      address: entry.address,
      rating: entry.rating,
      priceLevel: entry.price_level,
      imageUrl: entry.image_url,
      bookingUrl: entry.booking_url,
      mentionCount: entry.mention_count,
    }));
}

function buildCanonicalKey(title: string, bookingUrl?: string | null): string {
  const normalizedTitle = normalizeQuery(title);
  if (bookingUrl) return `${normalizedTitle}|${bookingUrl.trim().toLowerCase()}`;
  return normalizedTitle;
}

function normalizeQuery(value: string | undefined | null): string {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/gi, " ").trim();
}

function matchesQuery(memory: PlaceMemory, query: string): boolean {
  if (!query) return true;
  const haystack = normalizeQuery(
    [memory.title, memory.summary, memory.address].filter(Boolean).join(" ")
  );
  return haystack.includes(query);
}

function buildRecommendationScore(entry: PlaceMemory): number {
  const mentionScore = Number(entry.mention_count ?? 0) * 10;
  const ratingScore = Number(entry.rating ?? 0) * 5;
  const recencyScore = Date.parse(entry.last_mentioned_at ?? entry.created_at ?? "") || 0;
  return mentionScore + ratingScore + recencyScore / 1_000_000_000_000;
}

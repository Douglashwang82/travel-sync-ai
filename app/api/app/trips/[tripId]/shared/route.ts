import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/db";
import { requireAppTripAccess, requireAppTripWithGroup } from "@/lib/app-server";
import { extractUrlMetadata } from "@/services/share/extractor";
import { rememberPlace } from "@/services/memory";
import type { ItemType } from "@/lib/types";

type RouteContext = { params: Promise<{ tripId: string }> };

export interface SharedItem {
  id: string;
  itemType: ItemType;
  title: string;
  summary: string | null;
  address: string | null;
  rating: number | null;
  priceLevel: string | null;
  imageUrl: string | null;
  bookingUrl: string | null;
  mentionCount: number;
  lastMentionedAt: string;
  createdAt: string;
}

const ItemTypeEnum = z.enum([
  "hotel",
  "restaurant",
  "activity",
  "transport",
  "insurance",
  "flight",
  "other",
]);

/**
 * GET /api/app/trips/:tripId/shared
 *
 * Lists every URL the trip's members have shared (via the LINE `/share`
 * command or the web bento tile), newest mention first.
 */
export async function GET(
  req: NextRequest,
  ctx: RouteContext,
): Promise<NextResponse> {
  const { tripId } = await ctx.params;
  const auth = await requireAppTripAccess(req, tripId);
  if (!auth.ok) return auth.response;

  const db = createAdminClient();
  const { data, error } = await db
    .from("trip_memories")
    .select(
      "id, item_type, title, summary, address, rating, price_level, image_url, booking_url, mention_count, last_mentioned_at, created_at",
    )
    .eq("trip_id", tripId)
    .order("last_mentioned_at", { ascending: false })
    .limit(50);

  if (error) {
    return NextResponse.json(
      { error: "Failed to load shared items", code: "DB_ERROR" },
      { status: 500 },
    );
  }

  const items: SharedItem[] = (data ?? []).map((row) => ({
    id: row.id as string,
    itemType: row.item_type as ItemType,
    title: row.title as string,
    summary: (row.summary as string | null) ?? null,
    address: (row.address as string | null) ?? null,
    rating:
      typeof row.rating === "number"
        ? row.rating
        : row.rating == null
          ? null
          : Number(row.rating),
    priceLevel: (row.price_level as string | null) ?? null,
    imageUrl: (row.image_url as string | null) ?? null,
    bookingUrl: (row.booking_url as string | null) ?? null,
    mentionCount: Number(row.mention_count ?? 1),
    lastMentionedAt: row.last_mentioned_at as string,
    createdAt: row.created_at as string,
  }));

  return NextResponse.json({ items });
}

const PostSchema = z.object({
  url: z.string().url().max(2000),
  itemType: ItemTypeEnum.optional(),
});

/**
 * POST /api/app/trips/:tripId/shared
 *
 * Fetches the URL, asks Gemini to extract travel metadata, and persists the
 * result through `rememberPlace`. Same code path as the LINE `/share` command
 * so an item shared from web is indistinguishable from one shared via LINE.
 */
export async function POST(
  req: NextRequest,
  ctx: RouteContext,
): Promise<NextResponse> {
  const { tripId } = await ctx.params;
  const auth = await requireAppTripWithGroup(req, tripId);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON", code: "INVALID_JSON" },
      { status: 400 },
    );
  }

  const parsed = PostSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Validation failed",
        code: "VALIDATION_ERROR",
        details: parsed.error.flatten(),
      },
      { status: 400 },
    );
  }

  let metadata;
  try {
    metadata = await extractUrlMetadata(parsed.data.url);
  } catch (err) {
    console.error("[shared.POST] extraction failed", err);
    return NextResponse.json(
      {
        error:
          "We couldn't read that link. It may require login or block bots — try a different URL.",
        code: "EXTRACTION_FAILED",
      },
      { status: 422 },
    );
  }

  const itemType = parsed.data.itemType ?? metadata.item_type;

  const remembered = await rememberPlace({
    tripId,
    groupId: auth.groupId,
    itemType,
    title: metadata.name,
    summary: metadata.description,
    address: metadata.address,
    rating: metadata.rating,
    priceLevel: metadata.price,
    imageUrl: metadata.image_url,
    bookingUrl: metadata.booking_url,
    sourceLineUserId: auth.lineUserId,
  });

  if (!remembered) {
    return NextResponse.json(
      { error: "Failed to save shared item", code: "DB_ERROR" },
      { status: 500 },
    );
  }

  const item: SharedItem = {
    id: remembered.id,
    itemType: remembered.item_type,
    title: remembered.title,
    summary: remembered.summary,
    address: remembered.address,
    rating:
      typeof remembered.rating === "number"
        ? remembered.rating
        : remembered.rating == null
          ? null
          : Number(remembered.rating),
    priceLevel: remembered.price_level,
    imageUrl: remembered.image_url,
    bookingUrl: remembered.booking_url,
    mentionCount: Number(remembered.mention_count ?? 1),
    lastMentionedAt: remembered.last_mentioned_at,
    createdAt: remembered.created_at,
  };

  return NextResponse.json({ item }, { status: 201 });
}

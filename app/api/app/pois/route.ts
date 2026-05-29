import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/app-server";
import { createAdminClient } from "@/lib/db";
import {
  SAVED_POI_TYPES,
  rowToSavedPoi,
  type SavedPoi,
} from "@/lib/app-pois";

export interface SavedPoisResponse {
  pois: SavedPoi[];
}

export interface SavePoiResult {
  poi: SavedPoi;
  /** True when the place was already saved and we returned the existing row. */
  alreadySaved: boolean;
}

const SELECT =
  "id, place_id, name, item_type, address, lat, lng, notes, source, destination_name, google_maps_url, created_at";

/**
 * GET /api/app/pois
 *
 * Lists the signed-in user's saved POIs ("My Places"), newest first. Private to
 * the owning LINE user — ownership is enforced server-side via line_user_id.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAppUser(req);
  if (!auth.ok) return auth.response;

  const db = createAdminClient();
  const { data, error } = await db
    .from("user_saved_pois")
    .select(SELECT)
    .eq("line_user_id", auth.lineUserId)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json(
      { error: "讀取地點失敗", code: "DB_ERROR" },
      { status: 500 }
    );
  }

  const pois = (data ?? []).map(rowToSavedPoi);
  return NextResponse.json<SavedPoisResponse>({ pois });
}

const CreateSchema = z.object({
  placeId: z.string().max(256).nullish(),
  name: z.string().trim().min(1).max(200),
  itemType: z.enum(SAVED_POI_TYPES).default("activity"),
  address: z.string().max(400).nullish(),
  lat: z.number().gte(-90).lte(90),
  lng: z.number().gte(-180).lte(180),
  notes: z.string().max(1000).nullish(),
  source: z.enum(["curated", "google", "manual", "explorer"]).default("manual"),
  destinationName: z.string().max(120).nullish(),
  googleMapsUrl: z.string().url().max(2048).nullish(),
});

/**
 * POST /api/app/pois
 *
 * Saves a place to the user's "My Places" list. Idempotent on (user, placeId):
 * saving the same identifiable place again returns the existing row with
 * `alreadySaved: true` rather than erroring.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAppUser(req);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "JSON 格式無效", code: "INVALID_JSON" },
      { status: 400 }
    );
  }

  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "資料驗證失敗",
        code: "VALIDATION_ERROR",
        details: parsed.error.flatten(),
      },
      { status: 400 }
    );
  }

  const input = parsed.data;
  const db = createAdminClient();

  // Idempotency: if this identifiable place is already saved, return it.
  if (input.placeId) {
    const { data: existing } = await db
      .from("user_saved_pois")
      .select(SELECT)
      .eq("line_user_id", auth.lineUserId)
      .eq("place_id", input.placeId)
      .maybeSingle();
    if (existing) {
      return NextResponse.json<SavePoiResult>({
        poi: rowToSavedPoi(existing),
        alreadySaved: true,
      });
    }
  }

  const { data, error } = await db
    .from("user_saved_pois")
    .insert({
      line_user_id: auth.lineUserId,
      place_id: input.placeId ?? null,
      name: input.name,
      item_type: input.itemType,
      address: input.address ?? null,
      lat: input.lat,
      lng: input.lng,
      notes: input.notes ?? null,
      source: input.source,
      destination_name: input.destinationName ?? null,
      google_maps_url: input.googleMapsUrl ?? null,
    })
    .select(SELECT)
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: "儲存地點失敗", code: "DB_ERROR" },
      { status: 500 }
    );
  }

  return NextResponse.json<SavePoiResult>(
    { poi: rowToSavedPoi(data), alreadySaved: false },
    { status: 201 }
  );
}

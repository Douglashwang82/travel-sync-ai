import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/db";
import {
  POI_ITEM_TYPES,
  upsertPoi,
  validatePoiInput,
  type PoiInput,
  type PoiItemType,
} from "@/services/admin/poi-upsert";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function gateOr404(): NextResponse | null {
  if (process.env.ADMIN_BOARD_ENABLED !== "true") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return null;
}

type RouteContext = { params: Promise<{ placeId: string }> };

export async function GET(_req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const blocked = gateOr404();
  if (blocked) return blocked;
  const { placeId } = await ctx.params;
  const db = createAdminClient();
  const { data, error } = await db
    .from("poi_embeddings")
    .select("place_id, destination_name, destination_aliases, name, item_type, tags, description, lat, lng, source, last_seen_at")
    .eq("place_id", placeId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(data);
}

export async function PATCH(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const blocked = gateOr404();
  if (blocked) return blocked;
  const { placeId } = await ctx.params;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const db = createAdminClient();
  const { data: existing, error: fetchErr } = await db
    .from("poi_embeddings")
    .select("place_id, destination_name, destination_aliases, name, item_type, tags, description, lat, lng, source")
    .eq("place_id", placeId)
    .maybeSingle();
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  const descriptionChanged =
    typeof body.description === "string" && body.description !== (existing.description as string);
  const nameChanged = typeof body.name === "string" && body.name !== (existing.name as string);
  const tagsChanged = Array.isArray(body.tags);
  const itemTypeChanged = typeof body.item_type === "string" && body.item_type !== (existing.item_type as string);
  const destinationChanged =
    typeof body.destination_name === "string" && body.destination_name !== (existing.destination_name as string);
  const needsReembed = descriptionChanged || nameChanged || tagsChanged || itemTypeChanged || destinationChanged;

  if (needsReembed) {
    const merged: PoiInput = {
      place_id: placeId,
      destination_name: (body.destination_name as string) ?? (existing.destination_name as string),
      destination_aliases: Array.isArray(body.destination_aliases)
        ? (body.destination_aliases as string[])
        : ((existing.destination_aliases as string[] | null) ?? []),
      name: (body.name as string) ?? (existing.name as string),
      item_type: ((body.item_type as PoiItemType) ?? (existing.item_type as PoiItemType)),
      tags: Array.isArray(body.tags) ? (body.tags as string[]) : ((existing.tags as string[] | null) ?? []),
      description: (body.description as string) ?? (existing.description as string),
      lat: body.lat === undefined ? (existing.lat as number | null) : (body.lat as number | null),
      lng: body.lng === undefined ? (existing.lng as number | null) : (body.lng as number | null),
      source: (body.source as string) ?? (existing.source as string),
    };
    if (!POI_ITEM_TYPES.includes(merged.item_type)) {
      return NextResponse.json({ error: `item_type must be one of ${POI_ITEM_TYPES.join(", ")}` }, { status: 400 });
    }
    const validated = validatePoiInput(merged);
    if (!validated.ok) {
      return NextResponse.json({ error: validated.error }, { status: 400 });
    }
    const result = await upsertPoi(validated.value);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });
    return NextResponse.json({ ok: true, re_embedded: true });
  }

  // Metadata-only patch (lat/lng/aliases/source) — no re-embedding.
  const patch: Record<string, unknown> = {};
  if (body.lat !== undefined) patch.lat = body.lat;
  if (body.lng !== undefined) patch.lng = body.lng;
  if (Array.isArray(body.destination_aliases)) {
    patch.destination_aliases = (body.destination_aliases as unknown[])
      .filter((a): a is string => typeof a === "string")
      .map((a) => a.trim().toLowerCase())
      .filter((a) => a.length > 0);
  }
  if (typeof body.source === "string") patch.source = body.source;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: true, re_embedded: false });
  }
  const { error } = await db.from("poi_embeddings").update(patch).eq("place_id", placeId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, re_embedded: false });
}

export async function DELETE(_req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const blocked = gateOr404();
  if (blocked) return blocked;
  const { placeId } = await ctx.params;
  const db = createAdminClient();

  // route_templates may reference this place_id — block delete if so.
  const { data: refs, error: refsErr } = await db
    .from("route_templates")
    .select("id, title")
    .contains("place_ids", [placeId])
    .limit(5);
  if (refsErr) return NextResponse.json({ error: refsErr.message }, { status: 500 });
  if (refs && refs.length > 0) {
    return NextResponse.json(
      {
        error: "POI is referenced by route_templates; archive those routes first.",
        referenced_by: refs,
      },
      { status: 409 }
    );
  }

  const { error } = await db.from("poi_embeddings").delete().eq("place_id", placeId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await db.from("place_details_cache").delete().eq("place_id", placeId);
  return NextResponse.json({ ok: true });
}

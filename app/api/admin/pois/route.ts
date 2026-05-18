import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/db";
import { POI_ITEM_TYPES, upsertPoi, validatePoiInput, type PoiItemType } from "@/services/admin/poi-upsert";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function gateOr404(): NextResponse | null {
  if (process.env.ADMIN_BOARD_ENABLED !== "true") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return null;
}

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const blocked = gateOr404();
  if (blocked) return blocked;

  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const itemType = url.searchParams.get("item_type")?.trim() ?? "";
  const destination = url.searchParams.get("destination")?.trim() ?? "";
  const pageRaw = Number(url.searchParams.get("page") ?? "1");
  const pageSizeRaw = Number(url.searchParams.get("page_size") ?? DEFAULT_PAGE_SIZE);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 1;
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number.isFinite(pageSizeRaw) ? Math.floor(pageSizeRaw) : DEFAULT_PAGE_SIZE));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const db = createAdminClient();
  let query = db
    .from("poi_embeddings")
    .select("place_id, destination_name, destination_aliases, name, item_type, tags, description, lat, lng, source, last_seen_at", {
      count: "exact",
    });

  if (itemType && POI_ITEM_TYPES.includes(itemType as PoiItemType)) {
    query = query.eq("item_type", itemType);
  }
  if (destination) {
    query = query.ilike("destination_name", `%${destination}%`);
  }
  if (q) {
    const escaped = q.replace(/[%_]/g, (m) => `\\${m}`);
    query = query.or(`name.ilike.%${escaped}%,place_id.ilike.%${escaped}%`);
  }

  const { data, error, count } = await query.order("last_seen_at", { ascending: false }).range(from, to);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    page,
    page_size: pageSize,
    total: count ?? 0,
    items: data ?? [],
  });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const blocked = gateOr404();
  if (blocked) return blocked;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const validated = validatePoiInput(body);
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }

  const result = await upsertPoi(validated.value);
  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? "upsert failed" }, { status: 500 });
  }
  return NextResponse.json({ place_id: result.place_id, ok: true });
}

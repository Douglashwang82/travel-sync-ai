import { NextResponse, type NextRequest } from "next/server";
import { bulkUpsertPois, csvRowToPoiInput, parseCsvRows } from "@/services/admin/poi-upsert";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_ITEMS = 500;

function gateOr404(): NextResponse | null {
  if (process.env.ADMIN_BOARD_ENABLED !== "true") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return null;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const blocked = gateOr404();
  if (blocked) return blocked;

  const contentType = req.headers.get("content-type") ?? "";

  let items: unknown[] = [];

  if (contentType.includes("application/json")) {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
    }
    if (Array.isArray(body)) {
      items = body;
    } else if (body && typeof body === "object") {
      const maybeItems = (body as { items?: unknown; pois?: unknown }).items ?? (body as { pois?: unknown }).pois;
      if (Array.isArray(maybeItems)) items = maybeItems;
      else return NextResponse.json({ error: "expected an array or { items: [...] }" }, { status: 400 });
    } else {
      return NextResponse.json({ error: "expected an array or { items: [...] }" }, { status: 400 });
    }
  } else if (contentType.includes("text/csv") || contentType.includes("text/plain")) {
    const csv = await req.text();
    items = parseCsvRows(csv).map(csvRowToPoiInput);
  } else {
    return NextResponse.json(
      { error: "content-type must be application/json or text/csv" },
      { status: 415 }
    );
  }

  if (items.length === 0) {
    return NextResponse.json({ error: "no items found" }, { status: 400 });
  }
  if (items.length > MAX_ITEMS) {
    return NextResponse.json(
      { error: `too many items (${items.length}); max ${MAX_ITEMS} per request` },
      { status: 413 }
    );
  }

  const summary = await bulkUpsertPois(items);
  return NextResponse.json(summary);
}

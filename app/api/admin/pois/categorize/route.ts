import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/db";
import { suggestCategory } from "@/services/admin/poi-curation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function gateOr404(): NextResponse | null {
  if (process.env.ADMIN_BOARD_ENABLED !== "true") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return null;
}

const Body = z.object({
  /** Restrict the pass to one destination (ilike substring); omit for all. */
  destination: z.string().trim().min(1).max(120).optional(),
  /** When true, re-categorize rows that already have a category too. */
  overwrite: z.boolean().default(false),
});

/**
 * POST /api/admin/pois/categorize — bulk heuristic categorization.
 *
 * Fills poi_embeddings.category using the deterministic keyword mapper in
 * services/admin/poi-curation.ts (item_type + tags + name; no LLM, instant,
 * repeatable). By default only rows with a null category are touched, so
 * manual curation is never clobbered — pass overwrite=true to redo everything.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const blocked = gateOr404();
  if (blocked) return blocked;

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json().catch(() => ({})));
  } catch (err) {
    return NextResponse.json(
      { error: "invalid body", code: "INVALID_BODY", details: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }

  const db = createAdminClient();
  let query = db.from("poi_embeddings").select("place_id, name, item_type, tags, category");
  if (!body.overwrite) query = query.is("category", null);
  if (body.destination) query = query.ilike("destination_name", `%${body.destination}%`);
  const { data, error } = await query.limit(2000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let updated = 0;
  const failures: string[] = [];
  for (const row of data ?? []) {
    const category = suggestCategory(row.item_type, row.tags ?? [], row.name);
    if (!body.overwrite && row.category != null) continue;
    if (row.category === category) continue;
    const { error: updateError } = await db
      .from("poi_embeddings")
      .update({ category, curated_at: new Date().toISOString() })
      .eq("place_id", row.place_id);
    if (updateError) failures.push(`${row.place_id}: ${updateError.message}`);
    else updated++;
  }

  return NextResponse.json({
    scanned: (data ?? []).length,
    updated,
    failed: failures.length,
    failures: failures.slice(0, 10),
  });
}

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/db";
import { authenticateLiffRequest } from "@/lib/liff-server";

const RUNS_LIMIT = 15;

/**
 * GET /api/liff/tracking/runs?listId=<uuid>
 *
 * Returns the last RUNS_LIMIT tracking_runs rows for one of the caller's
 * tracking_lists. Validates ownership so users can only see their own runs.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await authenticateLiffRequest(req);
  if (!auth.ok) return auth.response;

  const listId = req.nextUrl.searchParams.get("listId");
  if (!listId) {
    return NextResponse.json({ error: "listId required", code: "VALIDATION_ERROR" }, { status: 400 });
  }

  const db = createAdminClient();

  // Ownership check — list must belong to caller.
  const { data: list } = await db
    .from("tracking_lists")
    .select("id")
    .eq("id", listId)
    .eq("line_user_id", auth.lineUserId)
    .single();

  if (!list) {
    return NextResponse.json({ error: "Not found", code: "NOT_FOUND" }, { status: 404 });
  }

  const { data: runs, error } = await db
    .from("tracking_runs")
    .select("id, status, started_at, finished_at, new_item_count, error")
    .eq("tracking_list_id", listId)
    .order("started_at", { ascending: false })
    .limit(RUNS_LIMIT);

  if (error) {
    return NextResponse.json({ error: "DB error", code: "DB_ERROR" }, { status: 500 });
  }

  return NextResponse.json({ runs: runs ?? [] });
}

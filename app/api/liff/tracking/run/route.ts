import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/db";
import { authenticateLiffRequest } from "@/lib/liff-server";
import { runTrackingList } from "@/services/tracking/runner";
import type { TrackingList } from "@/services/tracking/types";

const BodySchema = z.object({ id: z.string().uuid() });

/**
 * POST /api/liff/tracking/run
 *
 * Manually trigger the pipeline for one of the caller's tracking_lists rows.
 * Returns the RunnerResult plus the items that were inserted/updated.
 * Useful for validating a newly-added source and for the "run now" button.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await authenticateLiffRequest(req);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON", code: "INVALID_JSON" }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", code: "VALIDATION_ERROR" },
      { status: 400 }
    );
  }

  const db = createAdminClient();
  const { data: list, error } = await db
    .from("tracking_lists")
    .select(
      "id, line_user_id, group_id, source_type, source_url, display_name, category, keywords, region, is_active, frequency_hours, last_run_at, last_success_at, consecutive_failures"
    )
    .eq("id", parsed.data.id)
    .eq("line_user_id", auth.lineUserId)
    .single();

  if (error || !list) {
    return NextResponse.json({ error: "Not found", code: "NOT_FOUND" }, { status: 404 });
  }

  const result = await runTrackingList(list as TrackingList);

  const { data: items } = await db
    .from("tracking_items")
    .select("id, external_id, title, summary, url, category, location, tags, first_seen_at")
    .eq("tracking_list_id", list.id)
    .order("first_seen_at", { ascending: false })
    .limit(20);

  return NextResponse.json({ result, items: items ?? [] });
}

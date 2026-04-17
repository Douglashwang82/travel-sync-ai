import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/db";
import { authenticateLiffRequest } from "@/lib/liff-server";

// ─── Schemas ─────────────────────────────────────────────────────────────────

const SourceTypeEnum = z.enum([
  "website",
  "rss",
  "instagram",
  "threads",
  "x",
  "youtube",
  "tiktok",
]);

const CategoryEnum = z.enum([
  "travel",
  "restaurant",
  "attraction",
  "event",
  "other",
]);

const CreateSchema = z.object({
  action: z.literal("create"),
  sourceType: SourceTypeEnum,
  sourceUrl: z.string().url().max(500),
  displayName: z.string().max(120).nullable().optional(),
  category: CategoryEnum.default("travel"),
  keywords: z.array(z.string().max(40)).max(16).default([]),
  region: z.string().max(60).nullable().optional(),
  frequencyHours: z.number().int().min(1).max(24 * 14).default(24),
  groupId: z.string().uuid().nullable().optional(),
});

const UpdateSchema = z.object({
  action: z.literal("update"),
  id: z.string().uuid(),
  isActive: z.boolean().optional(),
  category: CategoryEnum.optional(),
  keywords: z.array(z.string().max(40)).max(16).optional(),
  frequencyHours: z.number().int().min(1).max(24 * 14).optional(),
});

const DeleteSchema = z.object({
  action: z.literal("delete"),
  id: z.string().uuid(),
});

const BodySchema = z.discriminatedUnion("action", [
  CreateSchema,
  UpdateSchema,
  DeleteSchema,
]);

// ─── Routes ──────────────────────────────────────────────────────────────────

/** GET — list the caller's tracking subscriptions. */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await authenticateLiffRequest(req);
  if (!auth.ok) return auth.response;

  const db = createAdminClient();
  const { data, error } = await db
    .from("tracking_lists")
    .select(
      "id, source_type, source_url, display_name, category, keywords, region, is_active, frequency_hours, last_run_at, last_success_at, consecutive_failures"
    )
    .eq("line_user_id", auth.lineUserId)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: "DB error", code: "DB_ERROR" }, { status: 500 });
  }

  return NextResponse.json({ items: data ?? [] });
}

/** POST — create / update / delete via `action` field. */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await authenticateLiffRequest(req);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON", code: "INVALID_JSON" },
      { status: 400 }
    );
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const db = createAdminClient();
  const data = parsed.data;

  if (data.action === "create") {
    const { data: inserted, error } = await db
      .from("tracking_lists")
      .insert({
        line_user_id: auth.lineUserId,
        group_id: data.groupId ?? null,
        source_type: data.sourceType,
        source_url: data.sourceUrl,
        display_name: data.displayName ?? null,
        category: data.category,
        keywords: data.keywords,
        region: data.region ?? null,
        frequency_hours: data.frequencyHours,
      })
      .select()
      .single();

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json(
          { error: "Already tracking this URL", code: "DUPLICATE" },
          { status: 409 }
        );
      }
      return NextResponse.json({ error: error.message, code: "DB_ERROR" }, { status: 500 });
    }
    return NextResponse.json(inserted, { status: 201 });
  }

  if (data.action === "update") {
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (data.isActive !== undefined) patch.is_active = data.isActive;
    if (data.category) patch.category = data.category;
    if (data.keywords) patch.keywords = data.keywords;
    if (data.frequencyHours) patch.frequency_hours = data.frequencyHours;

    const { data: updated, error } = await db
      .from("tracking_lists")
      .update(patch)
      .eq("id", data.id)
      .eq("line_user_id", auth.lineUserId)
      .select()
      .single();

    if (error || !updated) {
      return NextResponse.json({ error: "Not found", code: "NOT_FOUND" }, { status: 404 });
    }
    return NextResponse.json(updated);
  }

  // delete
  const { error } = await db
    .from("tracking_lists")
    .delete()
    .eq("id", data.id)
    .eq("line_user_id", auth.lineUserId);

  if (error) {
    return NextResponse.json({ error: error.message, code: "DB_ERROR" }, { status: 500 });
  }
  return new NextResponse(null, { status: 204 });
}

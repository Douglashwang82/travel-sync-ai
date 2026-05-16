import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/db";
import { requireAppTripAccess } from "@/lib/app-server";
import { track } from "@/lib/analytics";
import {
  IDEA_CATEGORIES,
  type IdeaCategory,
  type TripIdea,
  type TripIdeasResponse,
} from "@/lib/app-ideas";

type RouteContext = { params: Promise<{ tripId: string }> };

/**
 * GET /api/app/trips/:tripId/ideas — list brainstorm ideas for this trip.
 * Visible to every group member; ordered newest-first.
 */
export async function GET(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const { tripId } = await ctx.params;
  const auth = await requireAppTripAccess(req, tripId);
  if (!auth.ok) return auth.response;

  const db = createAdminClient();
  const { data, error } = await db
    .from("trip_ideas")
    .select(
      "id, category, text, submitted_by, display_name, promoted, promoted_item_id, created_at, source_agent, source_run_id"
    )
    .eq("trip_id", tripId)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    return NextResponse.json(
      { error: "靈感載入失敗", code: "DB_ERROR" },
      { status: 500 }
    );
  }

  const ideas: TripIdea[] = (data ?? []).map((row) => ({
    id: row.id as string,
    category: row.category as IdeaCategory,
    text: row.text as string,
    submittedBy: row.submitted_by as string,
    displayName: (row.display_name as string | null) ?? null,
    promoted: !!row.promoted,
    promotedItemId: (row.promoted_item_id as string | null) ?? null,
    createdAt: row.created_at as string,
    isMine: (row.submitted_by as string) === auth.lineUserId,
    sourceAgent: (row.source_agent as string | null) ?? null,
    sourceRunId: (row.source_run_id as string | null) ?? null,
  }));

  return NextResponse.json<TripIdeasResponse>({ ideas });
}

const CreateIdeaSchema = z.object({
  category: z.enum(IDEA_CATEGORIES).default("general"),
  text: z.string().trim().min(1).max(500),
});

/**
 * POST /api/app/trips/:tripId/ideas — submit a brainstorm idea to the trip's group.
 */
export async function POST(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const { tripId } = await ctx.params;
  const auth = await requireAppTripAccess(req, tripId);
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

  const parsed = CreateIdeaSchema.safeParse(body);
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

  const db = createAdminClient();
  const { data: member } = await db
    .from("group_members")
    .select("display_name")
    .eq("group_id", auth.groupId)
    .eq("line_user_id", auth.lineUserId)
    .is("left_at", null)
    .maybeSingle();

  const { data: inserted, error } = await db
    .from("trip_ideas")
    .insert({
      trip_id: tripId,
      group_id: auth.groupId,
      submitted_by: auth.lineUserId,
      display_name: (member?.display_name as string | null) ?? null,
      category: parsed.data.category,
      text: parsed.data.text,
    })
    .select(
      "id, category, text, submitted_by, display_name, promoted, promoted_item_id, created_at"
    )
    .single();

  if (error || !inserted) {
    return NextResponse.json(
      { error: "靈感儲存失敗", code: "DB_ERROR" },
      { status: 500 }
    );
  }

  await track("idea_submitted", {
    groupId: auth.groupId,
    userId: auth.lineUserId,
    properties: { trip_id: tripId, category: parsed.data.category, source: "web" },
  });

  const idea: TripIdea = {
    id: inserted.id as string,
    category: inserted.category as IdeaCategory,
    text: inserted.text as string,
    submittedBy: inserted.submitted_by as string,
    displayName: (inserted.display_name as string | null) ?? null,
    promoted: !!inserted.promoted,
    promotedItemId: (inserted.promoted_item_id as string | null) ?? null,
    createdAt: inserted.created_at as string,
    isMine: true,
    sourceAgent: null,
    sourceRunId: null,
  };

  return NextResponse.json<{ idea: TripIdea }>({ idea }, { status: 201 });
}

const DeleteSchema = z.object({ id: z.string().uuid() });

/**
 * DELETE /api/app/trips/:tripId/ideas — remove an idea you submitted (and that
 * hasn't been promoted to a trip item yet).
 */
export async function DELETE(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const { tripId } = await ctx.params;
  const auth = await requireAppTripAccess(req, tripId);
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const idParam = url.searchParams.get("id");
  const parsed = DeleteSchema.safeParse({ id: idParam });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "缺少靈感 ID", code: "VALIDATION_ERROR" },
      { status: 400 }
    );
  }

  const db = createAdminClient();
  const { data: idea } = await db
    .from("trip_ideas")
    .select("id, trip_id, submitted_by, promoted")
    .eq("id", parsed.data.id)
    .maybeSingle();

  if (!idea || idea.trip_id !== tripId) {
    return NextResponse.json(
      { error: "找不到靈感", code: "NOT_FOUND" },
      { status: 404 }
    );
  }

  if (idea.submitted_by !== auth.lineUserId && auth.role !== "organizer") {
    return NextResponse.json(
      { error: "只能刪除你自己新增的靈感", code: "FORBIDDEN" },
      { status: 403 }
    );
  }

  if (idea.promoted) {
    return NextResponse.json(
      {
        error: "這個靈感已轉成投票，無法刪除",
        code: "IDEA_PROMOTED",
      },
      { status: 409 }
    );
  }

  const { error } = await db.from("trip_ideas").delete().eq("id", parsed.data.id);
  if (error) {
    return NextResponse.json(
      { error: "靈感刪除失敗", code: "DB_ERROR" },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}

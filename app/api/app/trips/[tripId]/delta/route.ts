import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/db";
import { requireAppTripAccess } from "@/lib/app-server";

type RouteContext = { params: Promise<{ tripId: string }> };

const QuerySchema = z.object({
  since: z.string().datetime({ offset: true }).optional(),
});

const DEFAULT_WINDOW_MS = 7 * 24 * 3_600_000;

export interface TripDeltaResponse {
  since: string;
  aiProposals: { count: number; titles: string[] };
  actions: { pending: number; autoApplied: number };
  expenses: { count: number; total: number; currency: string };
  agentRuns: { count: number };
}

/**
 * GET /api/app/trips/:tripId/delta — "what changed since I left": counts of
 * AI proposals, orchestrator actions, expenses, and agent runs since `since`
 * (ISO datetime; defaults to the last 7 days). Backs the workspace delta
 * strip under the trip hero.
 */
export async function GET(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const { tripId } = await ctx.params;
  const auth = await requireAppTripAccess(req, tripId);
  if (!auth.ok) return auth.response;

  const parsed = QuerySchema.safeParse({
    since: req.nextUrl.searchParams.get("since") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.message, code: "INVALID" },
      { status: 400 },
    );
  }

  const since = parsed.data.since ?? new Date(Date.now() - DEFAULT_WINDOW_MS).toISOString();
  const db = createAdminClient();

  const [aiItemsRes, actionsRes, expensesRes, gridsRes, tripRes] = await Promise.all([
    db
      .from("trip_items")
      .select("title")
      .eq("trip_id", tripId)
      .eq("source", "ai")
      .gt("created_at", since)
      .order("created_at", { ascending: false })
      .limit(50),
    db
      .from("orchestrator_actions")
      .select("status")
      .eq("trip_id", tripId)
      .gt("created_at", since)
      .limit(200),
    db.from("expenses").select("amount").eq("trip_id", tripId).gt("created_at", since).limit(200),
    db.from("custom_grids").select("id").eq("trip_id", tripId).gt("last_run_at", since).limit(100),
    db.from("trips").select("budget_currency").eq("id", tripId).maybeSingle(),
  ]);

  const aiTitles = (aiItemsRes.data ?? []).map((r) => r.title as string);
  const actions = actionsRes.data ?? [];
  const expenseRows = expensesRes.data ?? [];

  const body: TripDeltaResponse = {
    since,
    aiProposals: { count: aiTitles.length, titles: aiTitles.slice(0, 3) },
    actions: {
      pending: actions.filter((a) => a.status === "pending").length,
      autoApplied: actions.filter((a) => a.status === "auto_applied").length,
    },
    expenses: {
      count: expenseRows.length,
      total: expenseRows.reduce((sum, r) => sum + Number(r.amount ?? 0), 0),
      currency: (tripRes.data?.budget_currency as string | undefined) ?? "TWD",
    },
    agentRuns: { count: (gridsRes.data ?? []).length },
  };

  return NextResponse.json(body);
}

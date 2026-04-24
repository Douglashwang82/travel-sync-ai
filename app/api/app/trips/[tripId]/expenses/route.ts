import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/db";
import { requireAppTripAccess } from "@/lib/app-server";
import {
  loadTripExpensesForGroup,
  type AppExpensesResponse,
} from "@/lib/app-trip-expenses";
import {
  recordExpense,
  getAllMemberBeneficiaries,
} from "@/services/expenses";

type RouteContext = { params: Promise<{ tripId: string }> };

export async function GET(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const { tripId } = await ctx.params;
  const auth = await requireAppTripAccess(req, tripId);
  if (!auth.ok) return auth.response;

  try {
    const data = await loadTripExpensesForGroup(tripId, auth.groupId);
    return NextResponse.json<AppExpensesResponse>(data);
  } catch {
    return NextResponse.json(
      { error: "Failed to load expenses", code: "DB_ERROR" },
      { status: 500 }
    );
  }
}

const PostSchema = z.object({
  amount: z.number().positive(),
  description: z.string().min(1).max(200),
});

export async function POST(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const { tripId } = await ctx.params;
  const auth = await requireAppTripAccess(req, tripId);
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

  const parsed = PostSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const db = createAdminClient();
  const { data: me } = await db
    .from("group_members")
    .select("display_name")
    .eq("group_id", auth.groupId)
    .eq("line_user_id", auth.lineUserId)
    .is("left_at", null)
    .single();

  const displayName = (me?.display_name as string | null) ?? auth.lineUserId;

  const beneficiaries = await getAllMemberBeneficiaries(auth.groupId);
  if (!beneficiaries.some((b) => b.userId === auth.lineUserId)) {
    beneficiaries.push({ userId: auth.lineUserId, displayName });
  }

  try {
    const { id } = await recordExpense({
      groupId: auth.groupId,
      tripId,
      paidByUserId: auth.lineUserId,
      paidByDisplayName: displayName,
      amount: parsed.data.amount,
      description: parsed.data.description,
      beneficiaries,
    });
    return NextResponse.json({ id }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Failed to record expense",
        code: "DB_ERROR",
      },
      { status: 500 }
    );
  }
}

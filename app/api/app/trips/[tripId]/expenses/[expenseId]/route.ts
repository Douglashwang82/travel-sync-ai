import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/db";
import { requireAppTripAccess } from "@/lib/app-server";

type RouteContext = { params: Promise<{ tripId: string; expenseId: string }> };

/**
 * DELETE /api/app/trips/:tripId/expenses/:expenseId
 *
 * Deletes an expense and its splits. Only the original payer can delete their
 * own expense; organizers can delete any expense in the trip.
 */
export async function DELETE(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const { tripId, expenseId } = await ctx.params;
  const auth = await requireAppTripAccess(req, tripId);
  if (!auth.ok) return auth.response;

  const db = createAdminClient();
  const { data: expense } = await db
    .from("expenses")
    .select("id, paid_by_user_id, group_id, trip_id")
    .eq("id", expenseId)
    .single();

  if (!expense || expense.trip_id !== tripId || expense.group_id !== auth.groupId) {
    return NextResponse.json(
      { error: "Expense not found", code: "NOT_FOUND" },
      { status: 404 }
    );
  }

  const isPayer = expense.paid_by_user_id === auth.lineUserId;
  if (!isPayer && auth.role !== "organizer") {
    return NextResponse.json(
      { error: "Only the payer or an organizer can delete this expense", code: "FORBIDDEN" },
      { status: 403 }
    );
  }

  // expense_splits has ON DELETE CASCADE in the schema
  const { error } = await db.from("expenses").delete().eq("id", expenseId);
  if (error) {
    return NextResponse.json(
      { error: "Failed to delete expense", code: "DB_ERROR" },
      { status: 500 }
    );
  }

  return new NextResponse(null, { status: 204 });
}

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/db";

const QuerySchema = z.object({
  lineGroupId: z.string().min(1),
});

export async function GET(req: NextRequest): Promise<NextResponse> {
  const params = Object.fromEntries(req.nextUrl.searchParams.entries());
  const parsed = QuerySchema.safeParse(params);
  if (!parsed.success) {
    return NextResponse.json({ error: "Missing lineGroupId" }, { status: 400 });
  }

  const { lineGroupId } = parsed.data;
  const db = createAdminClient();

  const { data: group } = await db
    .from("line_groups")
    .select("id")
    .eq("line_group_id", lineGroupId)
    .single();

  if (!group) {
    return NextResponse.json({ error: "Group not found" }, { status: 404 });
  }

  // Get the most recently completed trip
  const { data: trip } = await db
    .from("trips")
    .select("id, destination_name, start_date, end_date, ended_at, budget_amount, budget_currency")
    .eq("group_id", group.id)
    .eq("status", "completed")
    .order("ended_at", { ascending: false })
    .limit(1)
    .single();

  if (!trip) {
    return NextResponse.json({ error: "No completed trip found" }, { status: 404 });
  }

  // Confirmed items (the trip timeline)
  const { data: confirmedItems } = await db
    .from("trip_items")
    .select("id, title, item_type, booking_ref, deadline_at, trip_item_options!trip_items_confirmed_option_id_fkey(name, address)")
    .eq("trip_id", trip.id)
    .eq("stage", "confirmed")
    .order("deadline_at", { ascending: true, nullsFirst: false });

  // Expense summary
  const { data: expenses } = await db
    .from("expenses")
    .select("id, description, amount, paid_by_display_name, created_at")
    .eq("trip_id", trip.id)
    .order("created_at", { ascending: true });

  const totalSpent = (expenses ?? []).reduce((sum, e) => sum + Number(e.amount), 0);

  // Group members
  const { data: members } = await db
    .from("group_members")
    .select("line_user_id, display_name")
    .eq("group_id", group.id)
    .order("display_name", { ascending: true });

  return NextResponse.json({
    trip: {
      id: trip.id,
      destinationName: trip.destination_name,
      startDate: trip.start_date,
      endDate: trip.end_date,
      endedAt: trip.ended_at,
      budgetAmount: trip.budget_amount ? Number(trip.budget_amount) : null,
      budgetCurrency: trip.budget_currency ?? "TWD",
    },
    confirmedItems: (confirmedItems ?? []).map((item) => ({
      id: item.id,
      title: item.title,
      itemType: item.item_type,
      bookingRef: item.booking_ref,
      scheduledAt: item.deadline_at,
      option: item.trip_item_options
        ? { name: (item.trip_item_options as { name: string | null }).name, address: (item.trip_item_options as { address: string | null }).address }
        : null,
    })),
    expenses: (expenses ?? []).map((e) => ({
      id: e.id,
      description: e.description,
      amount: Number(e.amount),
      paidBy: e.paid_by_display_name,
      createdAt: e.created_at,
    })),
    totalSpent,
    memberCount: members?.length ?? 0,
  });
}

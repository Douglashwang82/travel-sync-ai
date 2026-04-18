import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/db";

type OptionRow = { name: string | null; address: string | null };

type ConfirmedItemRow = {
  id: string;
  title: string;
  item_type: string;
  booking_ref: string | null;
  deadline_at: string | null;
  // Supabase join returns an array even for a to-one FK
  trip_item_options: OptionRow[] | OptionRow | null;
};

type ExpenseRow = {
  id: string;
  description: string | null;
  amount: unknown;
  paid_by_display_name: string | null;
  created_at: string;
};

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

  const typedExpenses = (expenses ?? []) as ExpenseRow[];
  const typedItems = (confirmedItems ?? []) as ConfirmedItemRow[];
  const totalSpent = typedExpenses.reduce((sum: number, e: ExpenseRow) => sum + Number(e.amount), 0);

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
    confirmedItems: typedItems.map((item: ConfirmedItemRow) => {
      const opt = Array.isArray(item.trip_item_options)
        ? (item.trip_item_options[0] ?? null)
        : (item.trip_item_options ?? null);
      return {
        id: item.id,
        title: item.title,
        itemType: item.item_type,
        bookingRef: item.booking_ref,
        scheduledAt: item.deadline_at,
        option: opt ? { name: opt.name, address: opt.address } : null,
      };
    }),
    expenses: typedExpenses.map((e: ExpenseRow) => ({
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

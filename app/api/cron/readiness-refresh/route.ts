import { NextRequest, NextResponse } from "next/server";
import { verifyCronRequest } from "@/lib/cron-auth";
import { createAdminClient } from "@/lib/db";
import { pushText } from "@/lib/line";
import { track } from "@/lib/analytics";

// Send booking reminders when departure is this many days away or fewer
const BOOKING_REMINDER_THRESHOLD_DAYS = 7;

/**
 * POST /api/cron/readiness-refresh
 *
 * Runs daily. For every active trip departing within the reminder threshold:
 *   1. Find confirmed decision items still with booking_status = 'needed'.
 *   2. If any exist, send a single reminder in the group chat listing them.
 *   3. Track a booking_reminder_sent analytics event per trip notified.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const authError = verifyCronRequest(req);
  if (authError) return authError;

  const db = createAdminClient();
  const now = new Date();
  const thresholdDate = new Date(
    now.getTime() + BOOKING_REMINDER_THRESHOLD_DAYS * 24 * 60 * 60 * 1000
  );

  // Find active trips departing within the threshold window
  const { data: trips } = await db
    .from("trips")
    .select("id, group_id, destination_name, start_date")
    .in("status", ["draft", "active"])
    .not("start_date", "is", null)
    .lte("start_date", thresholdDate.toISOString().slice(0, 10))
    .gte("start_date", now.toISOString().slice(0, 10));

  if (!trips?.length) {
    return NextResponse.json({ reminded: 0, tripsChecked: 0 });
  }

  let reminded = 0;

  for (const trip of trips) {
    // Find confirmed items still needing booking for this trip
    const { data: unbookedItems } = await db
      .from("trip_items")
      .select("id, title, item_type")
      .eq("trip_id", trip.id)
      .eq("stage", "confirmed")
      .eq("booking_status", "needed");

    if (!unbookedItems?.length) continue;

    // Resolve the LINE group ID for this trip
    const { data: lineGroup } = await db
      .from("line_groups")
      .select("line_group_id")
      .eq("id", trip.group_id)
      .single();

    if (!lineGroup?.line_group_id) continue;

    const daysUntilDeparture = Math.ceil(
      (new Date(trip.start_date!).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
    );

    const itemList = unbookedItems.map((item) => `• ${item.title}`).join("\n");

    await pushText(
      lineGroup.line_group_id,
      `📋 Booking reminder — ${trip.destination_name} is ${daysUntilDeparture} day${daysUntilDeparture === 1 ? "" : "s"} away.\n\n` +
        `The following items are confirmed but not yet booked:\n${itemList}\n\n` +
        `Once a booking is done, reply with:\n/booked [item name] [confirmation ref]`
    );

    await track("booking_reminder_sent", {
      groupId: trip.group_id,
      properties: {
        trip_id: trip.id,
        days_until_departure: daysUntilDeparture,
        unbooked_count: unbookedItems.length,
      },
    });

    reminded++;
    console.info(
      `[cron/readiness-refresh] reminded trip ${trip.id} — ${unbookedItems.length} unbooked item(s), ${daysUntilDeparture}d until departure`
    );
  }

  console.info(
    `[cron/readiness-refresh] checked ${trips.length} trip(s), sent reminders to ${reminded}`
  );
  return NextResponse.json({ reminded, tripsChecked: trips.length });
}

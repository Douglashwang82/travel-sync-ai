import { NextRequest, NextResponse } from "next/server";
import { verifyCronRequest } from "@/lib/cron-auth";
import { createAdminClient } from "@/lib/db";
import { pushText } from "@/lib/line";
import { track } from "@/lib/analytics";

const STALE_HOURS = 48;
// Don't send stale reminders more than once every 24h per group
const REMINDER_COOLDOWN_HOURS = 24;

/**
 * GET /api/cron/stale-reminders
 *
 * Runs hourly. Notifies groups that have To-Do items which haven't been
 * touched in 48+ hours and haven't been reminded recently.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const authError = verifyCronRequest(req);
  if (authError) return authError;

  const db = createAdminClient();
  const staleThreshold = new Date(Date.now() - STALE_HOURS * 60 * 60 * 1000).toISOString();
  const cooldownThreshold = new Date(Date.now() - REMINDER_COOLDOWN_HOURS * 60 * 60 * 1000).toISOString();

  // Find active trips with stale todo items
  const { data: staleItems } = await db
    .from("trip_items")
    .select("id, title, trip_id, trips!inner(group_id, status)")
    .eq("stage", "todo")
    .lte("updated_at", staleThreshold)
    .eq("trips.status", "active")
    .limit(100);

  if (!staleItems?.length) {
    return NextResponse.json({ notified: 0 });
  }

  // Group stale items by trip
  const byTrip = new Map<string, { groupId: string; titles: string[] }>();
  for (const item of staleItems) {
    const trip = Array.isArray(item.trips) ? item.trips[0] : item.trips;
    if (!trip) continue;
    if (!byTrip.has(item.trip_id)) {
      byTrip.set(item.trip_id, { groupId: trip.group_id, titles: [] });
    }
    byTrip.get(item.trip_id)!.titles.push(item.title);
  }

  let notified = 0;

  for (const [, { groupId, titles }] of byTrip) {
    // Check cooldown
    const { data: recentReminder } = await db
      .from("analytics_events")
      .select("id")
      .eq("event_name", "nudge_sent")
      .eq("group_id", groupId)
      .gte("created_at", cooldownThreshold)
      .limit(1)
      .single();

    if (recentReminder) continue;

    // Fetch LINE group ID
    const { data: group } = await db
      .from("line_groups")
      .select("line_group_id")
      .eq("id", groupId)
      .single();

    if (!group?.line_group_id) continue;

    const itemList = titles.slice(0, 5).map((t) => `  • ${t}`).join("\n");
    const more = titles.length > 5 ? `\n  ...and ${titles.length - 5} more` : "";

    await pushText(
      group.line_group_id,
      `📋 A few trip items haven't been discussed in a while:\n\n${itemList}${more}\n\nType /status to see the full board, or /vote [item] to start a decision.`
    );

    await track("nudge_sent", {
      groupId,
      properties: { stale_count: titles.length, trigger: "cron" },
    });

    notified++;
  }

  console.info(`[cron/stale-reminders] notified ${notified} groups`);
  return NextResponse.json({ notified });
}

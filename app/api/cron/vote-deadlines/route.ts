import { NextRequest, NextResponse } from "next/server";
import { verifyCronRequest } from "@/lib/cron-auth";
import { createAdminClient } from "@/lib/db";
import { confirmItem } from "@/services/trip-state";
import { pushText } from "@/lib/line";
import { track } from "@/lib/analytics";

const TIE_EXTENSION_HOURS = 12;

/**
 * GET /api/cron/vote-deadlines
 *
 * Runs every 5 minutes. Closes expired votes by:
 * 1. Finding pending items past their deadline.
 * 2. Tallying votes and picking the winner.
 * 3. If tied: extend by 12 hours and notify organizer.
 * 4. If majority: confirm the item with the winning option.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const authError = verifyCronRequest(req);
  if (authError) return authError;

  const db = createAdminClient();
  const now = new Date().toISOString();

  // Find expired pending items
  const { data: expiredItems } = await db
    .from("trip_items")
    .select("id, title, trip_id")
    .eq("stage", "pending")
    .lte("deadline_at", now)
    .limit(50);

  if (!expiredItems?.length) {
    return NextResponse.json({ closed: 0 });
  }

  let closed = 0;

  for (const item of expiredItems) {
    // Tally votes for this item
    const { data: votesData } = await db
      .from("votes")
      .select("option_id")
      .eq("trip_item_id", item.id);

    const votes = votesData ?? [];

    if (votes.length === 0) {
      // No votes — revert to todo and notify
      await db
        .from("trip_items")
        .update({ stage: "todo", deadline_at: null, status_reason: "No votes received" })
        .eq("id", item.id);
      continue;
    }

    // Count votes per option
    const tally = new Map<string, number>();
    for (const v of votes) {
      tally.set(v.option_id, (tally.get(v.option_id) ?? 0) + 1);
    }

    const sorted = [...tally.entries()].sort((a, b) => b[1] - a[1]);
    const [topOptionId, topCount] = sorted[0];
    const isTied = sorted.length > 1 && sorted[1][1] === topCount;

    // Fetch group for notifications
    const { data: trip } = await db
      .from("trips")
      .select("group_id")
      .eq("id", item.trip_id)
      .single();

    const lineGroupId = trip
      ? (
          await db
            .from("line_groups")
            .select("line_group_id")
            .eq("id", trip.group_id)
            .single()
        ).data?.line_group_id
      : null;

    if (isTied) {
      // Extend by 12 hours
      const newDeadline = new Date(Date.now() + TIE_EXTENSION_HOURS * 60 * 60 * 1000).toISOString();
      await db
        .from("trip_items")
        .update({ deadline_at: newDeadline, status_reason: "Tied vote — extended" })
        .eq("id", item.id);

      if (lineGroupId) {
        await pushText(
          lineGroupId,
          `🤝 The vote for "${item.title}" is tied!\n\nVoting has been extended by ${TIE_EXTENSION_HOURS} hours. If it's still tied, the organizer will decide.`
        );
      }
    } else {
      // Confirm with the winner
      const result = await confirmItem(item.id, topOptionId);
      if (result.ok) {
        closed++;

        await track("vote_completed", {
          groupId: trip?.group_id,
          properties: {
            item_id: item.id,
            winning_option_id: topOptionId,
            vote_count: votes.length,
            participation_rate: topCount / votes.length,
          },
        });

        if (lineGroupId) {
          const { data: option } = await db
            .from("trip_item_options")
            .select("name")
            .eq("id", topOptionId)
            .single();

          await pushText(
            lineGroupId,
            `✅ Decision made! "${item.title}" → ${option?.name ?? "Selected option"}\n\nView the updated board in the dashboard.`
          );
        }
      }
    }
  }

  console.info(`[cron/vote-deadlines] closed ${closed}/${expiredItems.length} votes`);
  return NextResponse.json({ closed });
}

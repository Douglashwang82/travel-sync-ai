import { NextRequest, NextResponse } from "next/server";
import { verifyCronRequest } from "@/lib/cron-auth";
import { createAdminClient } from "@/lib/db";
import { closeVote } from "@/services/vote";
import { announceWinner } from "@/services/decisions";
import { pushText } from "@/lib/line";

const TIE_EXTENSION_HOURS = 12;
const MAX_TIE_EXTENSIONS = 2;

/**
 * GET /api/cron/vote-deadlines
 *
 * Runs every 5 minutes. Closes expired votes by:
 * 1. Finding pending items past their deadline.
 * 2. Tallying votes and picking the winner.
 * 3. If tied and under extension cap: extend by 12 hours and notify group.
 * 4. If tied and cap reached: revert to todo, notify organizer to decide manually.
 * 5. If no votes: revert to todo.
 * 6. Otherwise: close with the winning option.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const authError = verifyCronRequest(req);
  if (authError) return authError;

  const db = createAdminClient();
  const now = new Date().toISOString();

  // Find expired pending items
  const { data: expiredItems } = await db
    .from("trip_items")
    .select("id, title, trip_id, tie_extension_count")
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
      // No votes — revert to todo
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
      if (item.tie_extension_count >= MAX_TIE_EXTENSIONS) {
        // Cap reached — revert to todo and ask organizer to decide
        await db
          .from("trip_items")
          .update({
            stage: "todo",
            deadline_at: null,
            tie_extension_count: 0,
            status_reason: "Tie unresolved — organizer decision required",
          })
          .eq("id", item.id);

        if (lineGroupId) {
          await pushText(
            lineGroupId,
            `⚠️ The vote for "${item.title}" is still tied after ${MAX_TIE_EXTENSIONS} extensions.\n\nThe item has been moved back to the To-Do board. The organizer needs to make a final call.`
          );
        }
      } else {
        // Extend deadline
        const newDeadline = new Date(
          Date.now() + TIE_EXTENSION_HOURS * 60 * 60 * 1000
        ).toISOString();
        await db
          .from("trip_items")
          .update({
            deadline_at: newDeadline,
            tie_extension_count: item.tie_extension_count + 1,
            status_reason: "Tied vote — extended",
          })
          .eq("id", item.id);

        if (lineGroupId) {
          await pushText(
            lineGroupId,
            `🤝 The vote for "${item.title}" is tied!\n\nVoting has been extended by ${TIE_EXTENSION_HOURS} hours (extension ${item.tie_extension_count + 1}/${MAX_TIE_EXTENSIONS}).`
          );
        }
      }
    } else {
      // Clear winner — close the vote through the shared closeVote path
      // (handles confirmItem + analytics in one place)
      const { count: memberCount } = await db
        .from("group_members")
        .select("*", { count: "exact", head: true })
        .eq("group_id", trip?.group_id ?? "")
        .is("left_at", null);

      const { closed: didClose } = await closeVote(
        item.id,
        topOptionId,
        trip?.group_id ?? "",
        votes.length
      );

      if (didClose) {
        closed++;

        if (lineGroupId) {
          await announceWinner(
            item.id,
            topOptionId,
            lineGroupId,
            topCount,
            votes.length
          );
        }

        // Log participation rate separately (votes cast vs eligible members)
        const participationRate =
          memberCount && memberCount > 0 ? votes.length / memberCount : null;
        console.info(
          `[cron/vote-deadlines] closed "${item.title}" — winner votes: ${topCount}/${votes.length}` +
            (participationRate != null
              ? `, participation: ${(participationRate * 100).toFixed(0)}%`
              : "")
        );
      }
    }
  }

  console.info(`[cron/vote-deadlines] closed ${closed}/${expiredItems.length} votes`);
  return NextResponse.json({ closed });
}

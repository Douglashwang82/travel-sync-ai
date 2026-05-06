import { z } from "zod";
import { createAdminClient } from "@/lib/db";
import { pushText } from "@/lib/line";
import { startDecision } from "@/services/decisions";
import type { CommandContext } from "../router";
import { findBestTripItemMatch, getActiveTrip } from "../command-guards";

const ArgsSchema = z.array(z.string()).min(1);

export async function handleVote(
  args: string[],
  ctx: CommandContext,
  reply: (text: string) => Promise<void>
): Promise<void> {
  if (!ArgsSchema.safeParse(args).success || !ctx.dbGroupId || !ctx.lineGroupId) {
    await reply("Usage: /vote [item]\nExample: /vote hotel");
    return;
  }

  const itemQuery = args.join(" ").toLowerCase();
  const db = createAdminClient();

  const trip = await getActiveTrip(db, ctx.dbGroupId, "id, destination_name");

  if (!trip) {
    await reply("No active trip. Use /start to create one first.");
    return;
  }

  // Fetch todo AND pending items so we can give accurate feedback
  const { data: items } = await db
    .from("trip_items")
    .select("id, title, item_type, item_kind, stage")
    .eq("trip_id", trip.id)
    .in("stage", ["todo", "pending"]);

  const match = findBestTripItemMatch(items, itemQuery, "decision");

  if (!match) {
    await reply(
      `No decision item matching "${args.join(" ")}" found.\n` +
        `Use /decide ${args.join(" ")} to create one, or /status to see the board.`
    );
    return;
  }

  if (match.item_kind !== "decision") {
    await reply(
      `"${match.title}" is a planning item, not a decision item.\n` +
        `Use /decide ${match.item_type ?? args.join(" ")} to create a voteable decision first.`
    );
    return;
  }

  if (match.stage === "pending") {
    await reply(
      `Voting is already open for "${match.title}". Check the carousel above to cast your vote.`
    );
    return;
  }

  // Acknowledge immediately — place search may take a moment
  await reply(`Starting vote for "${match.title}"... I'll post the options shortly!`);
  
  await startDecision({
    itemId: match.id,
    tripId: trip.id,
    groupId: ctx.dbGroupId,
    lineGroupId: ctx.lineGroupId,
    destination: trip.destination_name ?? "",
  }).catch(async (err) => {
    console.error("[vote command] startDecision error", err);
    try {
      await pushText(
        ctx.lineGroupId!,
        `Sorry, something went wrong starting the vote for "${match.title}". Please try /vote again.`
      );
    } catch {
      // ignore secondary failure
    }
  });
}

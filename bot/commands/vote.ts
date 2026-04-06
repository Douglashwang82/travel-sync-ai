import { z } from "zod";
import { createAdminClient } from "@/lib/db";
import { pushText } from "@/lib/line";
import { startDecision } from "@/services/decisions";
import type { CommandContext } from "../router";

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

  const { data: trip } = await db
    .from("trips")
    .select("id, destination_name")
    .eq("group_id", ctx.dbGroupId)
    .in("status", ["draft", "active"])
    .single();

  if (!trip) {
    await reply("No active trip. Use /start to create one first.");
    return;
  }

  // Fetch todo AND pending items so we can give accurate feedback
  const { data: items } = await db
    .from("trip_items")
    .select("id, title, item_type, stage")
    .eq("trip_id", trip.id)
    .in("stage", ["todo", "pending"]);

  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const normalizedQuery = normalize(itemQuery);

  const match = items?.find((i) => {
    const normalizedTitle = normalize(i.title);
    return (
      normalizedTitle.includes(normalizedQuery) ||
      normalizedQuery.includes(normalizedTitle) ||
      normalize(i.item_type ?? "") === normalizedQuery
    );
  });

  if (!match) {
    await reply(
      `No To-Do item matching "${args.join(" ")}" found.\n` +
        `Use /status to see the board, or /add to create a new item.`
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
    destination: trip.destination_name,
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

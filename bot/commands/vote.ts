import { z } from "zod";
import { createAdminClient } from "@/lib/db";
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

  // Fetch all todo items for the active trip
  const { data: items } = await db
    .from("trip_items")
    .select("id, title, stage")
    .eq("trip_id", trip.id)
    .eq("stage", "todo");

  // Find the best matching todo item with fuzzy-ish name normalization
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const normalizedQuery = normalize(itemQuery);

  const match = items?.find((i) => {
    const normalizedTitle = normalize(i.title);
    return (
      normalizedTitle.includes(normalizedQuery) ||
      normalizedQuery.includes(normalizedTitle)
    );
  });

  if (!match) {
    await reply(
      `No To-Do item matching "${args.join(" ")}" found.\n` +
        `Use /status to see the board, or /add to create a new item.`
    );
    return;
  }

  // Acknowledge immediately — option fetching may take a moment
  await reply(`Starting vote for "${match.title}"... I'll post the options shortly!`);

  // Run the full decision flow asynchronously (don't await — reply token already used)
  startDecision({
    itemId: match.id,
    tripId: trip.id,
    groupId: ctx.dbGroupId,
    lineGroupId: ctx.lineGroupId,
    destination: trip.destination_name,
  }).catch((err) => {
    console.error("[vote command] startDecision error", err);
  });
}

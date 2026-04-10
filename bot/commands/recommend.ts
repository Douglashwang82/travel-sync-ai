import { z } from "zod";
import { createAdminClient } from "@/lib/db";
import { getRecommendations } from "@/services/memory";
import type { ItemType } from "@/lib/types";
import type { CommandContext } from "../router";

const ArgsSchema = z.array(z.string()).min(1);

const TYPE_MAP: Record<string, ItemType> = {
  hotel: "hotel",
  hotels: "hotel",
  restaurant: "restaurant",
  restaurants: "restaurant",
  food: "restaurant",
  activity: "activity",
  activities: "activity",
  transport: "transport",
  flight: "flight",
  flights: "flight",
};

export async function handleRecommend(
  args: string[],
  ctx: CommandContext,
  reply: (text: string) => Promise<void>
): Promise<void> {
  if (!ArgsSchema.safeParse(args).success || !ctx.dbGroupId) {
    await reply("Usage: /recommend [restaurant|hotel|activity] [optional keywords]");
    return;
  }

  const [typeArg, ...queryParts] = args;
  const itemType = TYPE_MAP[typeArg.toLowerCase()];
  if (!itemType) {
    await reply("I can recommend: restaurant, hotel, activity, transport, or flight.");
    return;
  }

  const db = createAdminClient();
  const { data: trip } = await db
    .from("trips")
    .select("id")
    .eq("group_id", ctx.dbGroupId)
    .in("status", ["draft", "active"])
    .single();

  if (!trip) {
    await reply("No active trip. Use /start to create one first.");
    return;
  }

  const recommendations = await getRecommendations(trip.id, itemType, queryParts.join(" "));

  if (recommendations.length === 0) {
    await reply(
      `I don't have any remembered ${itemType} suggestions yet.\n\n` +
        `Ask the group to mention places naturally or use /share [url], then try again.`
    );
    return;
  }

  const lines = recommendations.map((rec, index) => {
    const parts = [`${index + 1}. ${rec.title}`];
    if (rec.rating) parts.push(`⭐ ${rec.rating}`);
    if (rec.priceLevel) parts.push(rec.priceLevel);
    parts.push(`mentioned ${rec.mentionCount} time${rec.mentionCount === 1 ? "" : "s"}`);
    return parts.join("  ·  ");
  });

  await reply(
    `Here are the top remembered ${itemType} picks from your group chat:\n\n` +
      `${lines.join("\n")}\n\n` +
      `Use /decide ${itemType} when you want to turn these ideas into a group decision.`
  );
}

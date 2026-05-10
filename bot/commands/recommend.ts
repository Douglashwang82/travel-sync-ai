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
    await reply("用法：/recommend [restaurant|hotel|activity] [可選關鍵字]");
    return;
  }

  const [typeArg, ...queryParts] = args;
  const itemType = TYPE_MAP[typeArg.toLowerCase()];
  if (!itemType) {
    await reply("我可以推薦：restaurant、hotel、activity、transport 或 flight。");
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
    await reply("目前沒有進行中的旅程。請先使用 /start 建立旅程。");
    return;
  }

  const recommendations = await getRecommendations(trip.id, itemType, queryParts.join(" "));

  if (recommendations.length === 0) {
    await reply(
      `我目前還沒有記住任何 ${itemType} 的建議。\n\n` +
        `請大家在群組裡聊聊地點，或使用 /share [網址] 分享連結，再試一次。`
    );
    return;
  }

  const lines = recommendations.map((rec, index) => {
    const parts = [`${index + 1}. ${rec.title}`];
    if (rec.rating) parts.push(`⭐ ${rec.rating}`);
    if (rec.priceLevel) parts.push(rec.priceLevel);
    parts.push(`被提及 ${rec.mentionCount} 次`);
    return parts.join("  ·  ");
  });

  await reply(
    `以下是群組聊天中最常被記住的 ${itemType}：\n\n` +
      `${lines.join("\n")}\n\n` +
      `想把這些想法變成群組決定時，使用 /decide ${itemType}。`
  );
}

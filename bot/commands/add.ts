import { z } from "zod";
import { createAdminClient } from "@/lib/db";
import type { CommandContext } from "../router";
import type { ItemType } from "@/lib/types";

const ArgsSchema = z.array(z.string()).min(1);

const TYPE_KEYWORDS: Array<{ type: ItemType; keywords: string[] }> = [
  { type: "hotel",      keywords: ["hotel", "hotels", "hostel", "accommodation", "stay", "飯店", "旅館", "民宿"] },
  { type: "restaurant", keywords: ["restaurant", "food", "eat", "dining", "cafe", "餐廳", "吃飯", "美食"] },
  { type: "activity",   keywords: ["activity", "activities", "tour", "attraction", "sightseeing", "景點", "活動", "玩"] },
  { type: "transport",  keywords: ["transport", "transportation", "bus", "train", "taxi", "rental", "car", "火車", "高鐵", "巴士", "計程車", "租車"] },
  { type: "insurance",  keywords: ["insurance", "保險"] },
  { type: "flight",     keywords: ["flight", "flights", "airline", "plane", "機票", "航班", "班機"] },
];

export function inferItemType(title: string): ItemType {
  const lower = title.toLowerCase();
  for (const { type, keywords } of TYPE_KEYWORDS) {
    if (keywords.some((kw) => lower.includes(kw))) return type;
  }
  return "other";
}

export async function handleAdd(
  args: string[],
  ctx: CommandContext,
  reply: (text: string) => Promise<void>
): Promise<void> {
  if (!ArgsSchema.safeParse(args).success || !ctx.dbGroupId) {
    await reply(
      "Usage: /add [item]\n" +
        "Example: /add Shinjuku ramen place\n\n" +
        "Adds to the knowledge base. Use /decide [type] to turn knowledge items into a group vote."
    );
    return;
  }

  const title = args.join(" ");
  const itemType = inferItemType(title);
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

  const { error } = await db.from("trip_items").insert({
    trip_id: trip.id,
    title,
    item_type: itemType,
    item_kind: "knowledge",
    stage: "todo",
    source: "command",
  });

  if (error) {
    console.error("[add] failed to insert item", error);
    await reply("Failed to add the item. Please try again.");
    return;
  }

  await reply(
    `Added to knowledge base: "${title}"\n\n` +
      `Use /decide ${itemType} to start a group vote on all saved ${itemType} options.`
  );
}

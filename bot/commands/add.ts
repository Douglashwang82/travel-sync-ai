import { z } from "zod";
import { createAdminClient } from "@/lib/db";
import type { CommandContext } from "../router";
import type { ItemType } from "@/lib/types";
import { getActiveTrip } from "../command-guards";

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
    await reply("用法：/add [項目]\n範例：/add 預訂旅遊保險");
    return;
  }

  const title = args.join(" ");
  const itemType = inferItemType(title);
  const db = createAdminClient();

  const trip = await getActiveTrip(db, ctx.dbGroupId);

  if (!trip) {
    await reply("目前沒有進行中的旅程。請先使用 /start 建立旅程。");
    return;
  }

  const { error } = await db.from("trip_items").insert({
    trip_id: trip.id,
    title,
    item_type: itemType,
    item_kind: "task",
    stage: "todo",
    source: "command",
  });

  if (error) {
    console.error("[add] failed to insert item", error);
    await reply("新增項目失敗，請再試一次。");
    return;
  }

  await reply(
    `已加入待辦：「${title}」\n\n` +
      `這是一個任務。當群組需要在多個選項中做出選擇時，再使用 /decide。`
  );
}

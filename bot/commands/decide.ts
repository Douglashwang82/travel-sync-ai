import { z } from "zod";
import { createAdminClient } from "@/lib/db";
import { createItem } from "@/services/trip-state";
import type { CommandContext } from "../router";
import { inferItemType } from "./add";
import { getActiveTrip } from "../command-guards";

const ArgsSchema = z.array(z.string()).min(1);

function normalizeDecisionTitle(raw: string, inferredType: string): string {
  const compact = raw.trim();
  if (compact.toLowerCase() === inferredType.toLowerCase()) {
    return `選擇 ${inferredType}`;
  }
  return compact;
}

export async function handleDecide(
  args: string[],
  ctx: CommandContext,
  reply: (text: string) => Promise<void>
): Promise<void> {
  if (!ArgsSchema.safeParse(args).success || !ctx.dbGroupId) {
    await reply("用法：/decide [項目]\n範例：/decide restaurant");
    return;
  }

  const rawTitle = args.join(" ");
  const itemType = inferItemType(rawTitle);
  const title = normalizeDecisionTitle(rawTitle, itemType);
  const db = createAdminClient();

  const trip = await getActiveTrip(db, ctx.dbGroupId);

  if (!trip) {
    await reply("目前沒有進行中的旅程。請先使用 /start 建立旅程。");
    return;
  }

  const { data: existing } = await db
    .from("trip_items")
    .select("id, title, stage")
    .eq("trip_id", trip.id)
    .eq("item_kind", "decision")
    .ilike("title", title)
    .limit(1)
    .single();

  if (existing) {
    await reply(
      `這個決定項目已經存在：「${existing.title}」（${existing.stage}）。\n` +
        `當群組準備好時，使用 /vote ${itemType === "other" ? existing.title : itemType} 開始投票。`
    );
    return;
  }

  const result = await createItem({
    tripId: trip.id,
    title,
    itemType,
    itemKind: "decision",
    source: "command",
  });

  if (!result.ok) {
    await reply("建立決定項目失敗，請再試一次。");
    return;
  }

  await reply(
    `已建立決定項目：「${result.item.title}」\n\n` +
      `用 /option ${itemType === "other" ? result.item.title : itemType} | [選項] 加入選項，準備好後再用 /vote ${itemType === "other" ? result.item.title : itemType} 開始投票。`
  );
}

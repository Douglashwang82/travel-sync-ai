import { z } from "zod";
import { createAdminClient } from "@/lib/db";
import { addOption } from "@/services/trip-state";
import type { CommandContext } from "../router";
import { findBestTripItemMatch, getActiveTrip } from "../command-guards";

const ArgsSchema = z.array(z.string()).min(1);

export async function handleOption(
  args: string[],
  ctx: CommandContext,
  reply: (text: string) => Promise<void>
): Promise<void> {
  if (!ArgsSchema.safeParse(args).success || !ctx.dbGroupId) {
    await reply(
      "用法：/option [決定項目] | [選項名稱]\n" +
        "範例：/option restaurant | 大阪拉麵店"
    );
    return;
  }

  const raw = args.join(" ");
  const pipeIndex = raw.indexOf("|");

  if (pipeIndex === -1) {
    await reply(
      "請用 | 分隔決定項目和選項名稱。\n" +
        "範例：/option restaurant | 大阪拉麵店"
    );
    return;
  }

  const itemQuery = raw.slice(0, pipeIndex).trim();
  const optionName = raw.slice(pipeIndex + 1).trim();

  if (!itemQuery || !optionName) {
    await reply(
      "決定項目和選項名稱都必須提供。\n" +
        "範例：/option restaurant | 大阪拉麵店"
    );
    return;
  }

  const db = createAdminClient();

  const trip = await getActiveTrip(db, ctx.dbGroupId);

  if (!trip) {
    await reply("目前沒有進行中的旅程。請先使用 /start 建立旅程。");
    return;
  }

  const { data: items } = await db
    .from("trip_items")
    .select("id, title, item_type, item_kind, stage")
    .eq("trip_id", trip.id)
    .in("stage", ["todo", "pending"]);

  const match = findBestTripItemMatch(items, itemQuery, "decision");

  if (!match) {
    await reply(
      `找不到符合「${itemQuery}」的決定項目。\n` +
        `請先用 /decide ${itemQuery} 建立一個。`
    );
    return;
  }

  if (match.item_kind !== "decision") {
    await reply(
      `「${match.title}」是規劃任務，不是可投票的決定項目。\n` +
        `請先用 /decide ${match.item_type ?? itemQuery} 建立可投票的決定項目。`
    );
    return;
  }

  const result = await addOption({ itemId: match.id, name: optionName });

  if (!result.ok) {
    if (result.code === "DUPLICATE") {
      await reply(`「${optionName}」已經是「${match.title}」的選項了。`);
      return;
    }
    if (result.code === "ALREADY_CONFIRMED") {
      await reply(`「${match.title}」已經確認，不能再新增選項。`);
      return;
    }
    await reply("新增選項失敗，請再試一次。");
    return;
  }

  const stageNote =
    match.stage === "pending"
      ? `\n\n「${match.title}」目前正在投票中，這個選項已經可以被投票。`
      : `\n\n當群組準備好投票時，使用 /vote ${match.item_type ?? itemQuery}。`;

  await reply(`已將選項「${result.name}」加入「${match.title}」。${stageNote}`);
}

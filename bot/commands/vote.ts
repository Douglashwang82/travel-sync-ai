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
    await reply("用法：/vote [項目]\n範例：/vote hotel");
    return;
  }

  const itemQuery = args.join(" ").toLowerCase();
  const db = createAdminClient();

  const trip = await getActiveTrip(db, ctx.dbGroupId, "id, destination_name");

  if (!trip) {
    await reply("目前沒有進行中的旅程。請先使用 /start 建立旅程。");
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
      `找不到符合「${args.join(" ")}」的決定項目。\n` +
        `用 /decide ${args.join(" ")} 建立一個，或用 /status 查看看板。`
    );
    return;
  }

  if (match.item_kind !== "decision") {
    await reply(
      `「${match.title}」是規劃項目，不是可投票的決定項目。\n` +
        `請先用 /decide ${match.item_type ?? args.join(" ")} 建立可投票的決定項目。`
    );
    return;
  }

  if (match.stage === "pending") {
    await reply(
      `「${match.title}」已經在投票中，請查看上方的投票卡片。`
    );
    return;
  }

  // Acknowledge immediately — place search may take a moment
  await reply(`正在為「${match.title}」啟動投票⋯⋯選項馬上就會送出！`);

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
        `抱歉，啟動「${match.title}」的投票時出了問題，請再試一次 /vote。`
      );
    } catch {
      // ignore secondary failure
    }
  });
}

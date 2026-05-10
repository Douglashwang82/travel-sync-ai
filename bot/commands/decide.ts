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
    return `Choose ${inferredType}`;
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
      `Decision item already exists: "${existing.title}" (${existing.stage}).\n` +
        `Use /vote ${itemType === "other" ? existing.title : itemType} when the group is ready.`
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
    await reply("Failed to create the decision item. Please try again.");
    return;
  }

  await reply(
    `Created decision item: "${result.item.title}"\n\n` +
      `Add options with /option ${itemType === "other" ? result.item.title : itemType} | [option], then start voting with /vote ${itemType === "other" ? result.item.title : itemType}.`
  );
}

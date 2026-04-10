import { z } from "zod";
import { createAdminClient } from "@/lib/db";
import { createItem } from "@/services/trip-state";
import type { CommandContext } from "../router";
import { inferItemType } from "./add";

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
    await reply("Usage: /decide [item]\nExample: /decide restaurant");
    return;
  }

  const rawTitle = args.join(" ");
  const itemType = inferItemType(rawTitle);
  const title = normalizeDecisionTitle(rawTitle, itemType);
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
      `I'll use remembered knowledge and fresh search when you run /vote ${itemType === "other" ? result.item.title : itemType}.`
  );
}

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
      "Usage: /option [decision-item] | [option-name]\n" +
        "Example: /option restaurant | Ramen Shop Osaka"
    );
    return;
  }

  const raw = args.join(" ");
  const pipeIndex = raw.indexOf("|");

  if (pipeIndex === -1) {
    await reply(
      "Please separate the decision item and option name with |.\n" +
        "Example: /option restaurant | Ramen Shop Osaka"
    );
    return;
  }

  const itemQuery = raw.slice(0, pipeIndex).trim();
  const optionName = raw.slice(pipeIndex + 1).trim();

  if (!itemQuery || !optionName) {
    await reply(
      "Both a decision item and an option name are required.\n" +
        "Example: /option restaurant | Ramen Shop Osaka"
    );
    return;
  }

  const db = createAdminClient();

  const trip = await getActiveTrip(db, ctx.dbGroupId);

  if (!trip) {
    await reply("No active trip. Use /start to create one first.");
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
      `No decision item matching "${itemQuery}" found.\n` +
        `Use /decide ${itemQuery} to create one first.`
    );
    return;
  }

  if (match.item_kind !== "decision") {
    await reply(
      `"${match.title}" is a planning task, not a decision item.\n` +
        `Use /decide ${match.item_type ?? itemQuery} to create a voteable decision first.`
    );
    return;
  }

  const result = await addOption({ itemId: match.id, name: optionName });

  if (!result.ok) {
    if (result.code === "DUPLICATE") {
      await reply(`"${optionName}" is already an option for "${match.title}".`);
      return;
    }
    if (result.code === "ALREADY_CONFIRMED") {
      await reply(`"${match.title}" is already confirmed — no more options can be added.`);
      return;
    }
    await reply("Failed to add the option. Please try again.");
    return;
  }

  const stageNote =
    match.stage === "pending"
      ? `\n\nVoting is already open for "${match.title}" — this option is now available to vote on.`
      : `\n\nUse /vote ${match.item_type ?? itemQuery} when the group is ready to start voting.`;

  await reply(`Added option "${result.name}" to "${match.title}".${stageNote}`);
}

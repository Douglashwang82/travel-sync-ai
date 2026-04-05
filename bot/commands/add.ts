import { z } from "zod";
import { createAdminClient } from "@/lib/db";
import type { CommandContext } from "../router";

const ArgsSchema = z.array(z.string()).min(1);

export async function handleAdd(
  args: string[],
  ctx: CommandContext,
  reply: (text: string) => Promise<void>
): Promise<void> {
  if (!ArgsSchema.safeParse(args).success || !ctx.dbGroupId) {
    await reply("Usage: /add [item]\nExample: /add Book travel insurance");
    return;
  }

  const title = args.join(" ");
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
    stage: "todo",
    source: "command",
  });

  if (error) {
    console.error("[add] failed to insert item", error);
    await reply("Failed to add the item. Please try again.");
    return;
  }

  await reply(`Added to To-Do: "${title}"\n\nUse /vote ${title} to start a group decision.`);
}

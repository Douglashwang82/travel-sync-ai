import { z } from "zod";
import { createAdminClient } from "@/lib/db";
import { pushText } from "@/lib/line";
import { startDecision } from "@/services/decisions";
import { buildDecisionFromKnowledge, getKnowledgeItems } from "@/services/knowledge";
import { inferItemType } from "./add";
import type { CommandContext } from "../router";
import type { ItemType } from "@/lib/types";

const ArgsSchema = z.array(z.string()).min(1);

/**
 * /decide [type or topic]
 *
 * Promotes knowledge-base items into a group decision.
 * Collects all knowledge items of the requested type, creates a decision item
 * with those items as voteable options, then starts the vote carousel.
 *
 * Example: /decide restaurant  →  "Choose restaurant" decision with all
 *          saved restaurant knowledge items as candidates.
 */
export async function handleDecide(
  args: string[],
  ctx: CommandContext,
  reply: (text: string) => Promise<void>
): Promise<void> {
  if (!ArgsSchema.safeParse(args).success || !ctx.dbGroupId || !ctx.lineGroupId) {
    await reply(
      "Usage: /decide [type]\n" +
        "Example: /decide restaurant\n\n" +
        "Turns all saved restaurant knowledge items into a group vote."
    );
    return;
  }

  const query = args.join(" ").toLowerCase();
  const itemType: ItemType = inferItemType(query) !== "other" ? inferItemType(query) : (query as ItemType);

  const db = createAdminClient();

  const { data: trip } = await db
    .from("trips")
    .select("id, destination_name")
    .eq("group_id", ctx.dbGroupId)
    .in("status", ["draft", "active"])
    .single();

  if (!trip) {
    await reply("No active trip. Use /start to create one first.");
    return;
  }

  // Check that there are knowledge items to vote on
  const knowledge = await getKnowledgeItems(trip.id, itemType !== "other" ? itemType : undefined);

  if (knowledge.length === 0) {
    await reply(
      `No saved ${query} places found in the knowledge base.\n\n` +
        `Add some first with /add or /share, then run /decide ${query} again.`
    );
    return;
  }

  await reply(
    `Found ${knowledge.length} ${query} option${knowledge.length > 1 ? "s" : ""} in the knowledge base. Starting vote...`
  );

  // Create decision item from knowledge items
  const decisionId = await buildDecisionFromKnowledge(trip.id, itemType, `Choose ${query}`);

  if (!decisionId) {
    await pushText(ctx.lineGroupId, "Something went wrong creating the decision. Please try again.");
    return;
  }

  await startDecision({
    itemId: decisionId,
    tripId: trip.id,
    groupId: ctx.dbGroupId,
    lineGroupId: ctx.lineGroupId,
    destination: trip.destination_name,
  }).catch(async (err) => {
    console.error("[decide command] startDecision error", err);
    try {
      await pushText(ctx.lineGroupId!, "Sorry, something went wrong starting the vote. Please try /decide again.");
    } catch {
      // ignore secondary failure
    }
  });
}

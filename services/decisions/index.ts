import { createAdminClient } from "@/lib/db";
import { pushFlex, pushText } from "@/lib/line";
import { startVote } from "@/services/trip-state";
import { track } from "@/lib/analytics";
import { buildVoteCarousel, buildWinnerMessage } from "./flex";
import { getVoteTally } from "@/services/vote";
import type { ItemType } from "@/lib/types";
import { inferItemType } from "@/bot/commands/add";

const VOTE_DURATION_HOURS = 24;

export interface StartDecisionInput {
  itemId: string;
  tripId: string;
  groupId: string;
  lineGroupId: string;
  destination: string;
}

/**
 * Orchestrates the full /vote flow:
 *   1. Collect shared options from all same-type trip_items in the trip
 *   2. Copy any "sibling" options into the anchor item so downstream vote mechanics
 *      (refresh carousel, tally, close vote) can read from a single trip_item_id
 *   3. Move anchor item to pending (startVote)
 *   4. Build and push Flex Message carousel
 */
export async function startDecision(input: StartDecisionInput): Promise<void> {
  const { itemId, tripId, groupId, lineGroupId } = input;
  const db = createAdminClient();

  // Fetch anchor item details
  const { data: item } = await db
    .from("trip_items")
    .select("id, title, item_type, stage")
    .eq("id", itemId)
    .single();

  if (!item) {
    console.warn(`[decisions] Item ${itemId} not found`);
    await pushText(lineGroupId, `Could not find that item. Use /status to check the board.`);
    return;
  }

  const resolvedType: ItemType =
    item.item_type && item.item_type !== "other"
      ? (item.item_type as ItemType)
      : inferItemType(item.title);

  console.log(`[decisions] Starting vote for "${item.title}" (type: ${resolvedType}) in group ${lineGroupId}`);

  if (item.stage !== "todo") {
    await pushText(
      lineGroupId,
      `"${item.title}" is already ${item.stage}. Use /status to see the board.`
    );
    return;
  }

  // Collect options shared by group members across all same-type trip_items in this trip.
  // Each /share creates its own trip_item + option, so we aggregate them here.
  const { data: siblingItems } = await db
    .from("trip_items")
    .select("id")
    .eq("trip_id", tripId)
    .eq("item_type", resolvedType)
    .neq("id", itemId);

  const siblingItemIds = (siblingItems ?? []).map((r) => r.id);

  const { data: siblingOptions } = siblingItemIds.length
    ? await db
        .from("trip_item_options")
        .select("name, image_url, rating, price_level, address, booking_url, metadata_json")
        .in("trip_item_id", siblingItemIds)
    : { data: [] };

  // Check if anchor already has options (re-vote scenario)
  const { data: existingOptions } = await db
    .from("trip_item_options")
    .select("id")
    .eq("trip_item_id", itemId);

  // Import sibling options into the anchor item so all downstream logic reads from one item
  if (siblingOptions?.length && !existingOptions?.length) {
    const { error: importError } = await db.from("trip_item_options").insert(
      siblingOptions.map((o) => ({
        trip_item_id: itemId,
        provider: "manual" as const,
        name: o.name,
        image_url: o.image_url,
        rating: o.rating,
        price_level: o.price_level,
        address: o.address,
        booking_url: o.booking_url,
        metadata_json: o.metadata_json,
      }))
    );
    if (importError) {
      console.error("[decisions] failed to import sibling options", importError);
    }
  }

  // Fetch all options now on the anchor item (its own + imported siblings)
  const { data: allOptions } = await db
    .from("trip_item_options")
    .select("id, name, image_url, rating, price_level, address, booking_url")
    .eq("trip_item_id", itemId);

  if (!allOptions?.length) {
    console.log(`[decisions] No shared options found for "${item.title}" — item stays in todo`);
    await pushText(
      lineGroupId,
      `🗳️ No voting options yet for "${item.title}".\n\n` +
        `Ask group members to /share some links, then try again!`
    );
    return;
  }

  console.log(`[decisions] Found ${allOptions.length} option(s). Starting vote...`);

  // Move anchor item to pending
  const deadline = new Date(Date.now() + VOTE_DURATION_HOURS * 60 * 60 * 1000).toISOString();
  const transition = await startVote(itemId, deadline);
  if (!transition.ok) {
    await pushText(lineGroupId, `Could not start the vote: ${transition.error}`);
    return;
  }

  const voteOptions = allOptions.map((opt) => ({
    optionId: opt.id,
    candidate: {
      name: opt.name,
      address: opt.address,
      rating: opt.rating,
      priceLevel: opt.price_level,
      photoUrl: opt.image_url,
      placeId: "",
      bookingUrl: opt.booking_url,
    },
    voteCount: 0,
  }));

  const carousel = buildVoteCarousel(itemId, item.title, voteOptions);

  await track("vote_initiated", {
    groupId,
    properties: {
      item_id: itemId,
      item_type: resolvedType,
      options_count: allOptions.length,
    },
  });

  await pushText(
    lineGroupId,
    `🗳️ Vote started for "${item.title}"!\nSwipe to compare options and tap Vote. Closes in ${VOTE_DURATION_HOURS}h.`
  );
  await pushFlex(lineGroupId, `Vote: ${item.title}`, carousel);
  console.log(`[decisions] Decision flow completed successfully for ${itemId}`);
}

/**
 * Refresh and re-push the vote carousel with updated counts.
 * Called after each vote is cast so the group sees live tallies.
 */
export async function refreshVoteCarousel(
  itemId: string,
  lineGroupId: string
): Promise<void> {
  const db = createAdminClient();

  const { data: item } = await db
    .from("trip_items")
    .select("title, item_type")
    .eq("id", itemId)
    .single();

  const { data: options } = await db
    .from("trip_item_options")
    .select("id, name, image_url, rating, price_level, address, booking_url")
    .eq("trip_item_id", itemId);

  if (!item || !options?.length) return;

  const tally = await getVoteTally(itemId);

  const voteOptions = options.map((opt) => ({
    optionId: opt.id,
    candidate: {
      name: opt.name,
      address: opt.address,
      rating: opt.rating,
      priceLevel: opt.price_level,
      photoUrl: opt.image_url,
      placeId: "",
      bookingUrl: opt.booking_url,
    },
    voteCount: tally.get(opt.id) ?? 0,
  }));

  const carousel = buildVoteCarousel(itemId, item.title, voteOptions);
  await pushFlex(lineGroupId, `Vote: ${item.title}`, carousel);
}

/**
 * Announce the vote winner.
 * Callers must pass the pre-computed vote counts — no re-fetch needed.
 */
export async function announceWinner(
  itemId: string,
  winningOptionId: string,
  lineGroupId: string,
  winnerVotes: number,
  totalVotes: number
): Promise<void> {
  const db = createAdminClient();

  const [{ data: option }, { data: item }] = await Promise.all([
    db.from("trip_item_options").select("name").eq("id", winningOptionId).single(),
    db.from("trip_items").select("title").eq("id", itemId).single(),
  ]);

  await pushText(
    lineGroupId,
    buildWinnerMessage(
      item?.title ?? "Item",
      option?.name ?? "Selected option",
      winnerVotes,
      totalVotes
    )
  );
}

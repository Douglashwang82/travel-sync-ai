import { createAdminClient } from "@/lib/db";
import { pushFlex, pushText } from "@/lib/line";
import { startVote } from "@/services/trip-state";
import { track } from "@/lib/analytics";
import { searchPlaces } from "./places";
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
 *   1. Fetch place candidates from Google Places
 *   2. Persist as trip_item_options
 *   3. Move item to pending (startVote)
 *   4. Build and push Flex Message carousel
 */
export async function startDecision(input: StartDecisionInput): Promise<void> {
  const { itemId, tripId, groupId, lineGroupId, destination } = input;
  const db = createAdminClient();

  // Fetch item details
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

  // If item was created before type inference was in place, fall back to inferring from title
  const resolvedType: ItemType =
    item.item_type && item.item_type !== "other"
      ? (item.item_type as ItemType)
      : inferItemType(item.title);

  console.log(`[decisions] Starting flow for "${item.title}" (type: ${resolvedType}) in group ${lineGroupId}`);

  if (item.stage !== "todo") {
    await pushText(
      lineGroupId,
      `"${item.title}" is already ${item.stage}. Use /status to see the board.`
    );
    return;
  }

  // Fetch place candidates
  console.log(`[decisions] Searching for candidates in ${destination}...`);
  const { candidates, errorKind } = await searchPlaces(destination, resolvedType);

  if (candidates.length === 0) {
    console.log(`[decisions] No candidates found (errorKind: ${errorKind}) — item stays in todo`);

    // Do NOT move the item to pending — a vote with zero options is unvoteable.
    // Item remains in todo so the user can retry immediately.
    if (errorKind === "no_results") {
      await pushText(
        lineGroupId,
        `❌ No places found for "${item.title}" in ${destination}.\n\n` +
          `Add options via the trip dashboard, then start the vote again:\n  /vote ${item.title}`
      );
    } else {
      // network_error — likely transient
      await pushText(
        lineGroupId,
        `❌ Couldn't reach the places search for "${item.title}".\n\n` +
          `This is usually temporary. Try again in a few minutes:\n  /vote ${item.title}`
      );
    }
    return;
  }

  console.log(`[decisions] Found ${candidates.length} candidates. Persisting options...`);

  // Persist options
  const { data: insertedOptions, error: optionsError } = await db
    .from("trip_item_options")
    .insert(
      candidates.map((c) => ({
        trip_item_id: itemId,
        provider: "google_places" as const,
        external_ref: c.placeId,
        name: c.name,
        image_url: c.photoUrl,
        rating: c.rating,
        price_level: c.priceLevel,
        address: c.address,
        booking_url: c.bookingUrl,
        metadata_json: { place_id: c.placeId },
      }))
    )
    .select("id, name");

  if (optionsError || !insertedOptions?.length) {
    console.error("[decisions] failed to insert options", optionsError);
    await pushText(lineGroupId, `Something went wrong creating vote options. Please try again.`);
    return;
  }

  // Move item to pending
  const deadline = new Date(Date.now() + VOTE_DURATION_HOURS * 60 * 60 * 1000).toISOString();
  const transition = await startVote(itemId, deadline);
  if (!transition.ok) {
    await pushText(lineGroupId, `Could not start the vote: ${transition.error}`);
    return;
  }

  // Build carousel with current (zero) vote counts
  const voteOptions = insertedOptions.map((opt, i) => ({
    optionId: opt.id,
    candidate: candidates[i],
    voteCount: 0,
  }));

  const carousel = buildVoteCarousel(itemId, item.title, voteOptions);

  await track("vote_initiated", {
    groupId,
    properties: {
      item_id: itemId,
      item_type: resolvedType,
      options_count: insertedOptions.length,
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

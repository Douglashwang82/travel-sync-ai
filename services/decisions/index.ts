import { createAdminClient } from "@/lib/db";
import { pushFlex, pushText } from "@/lib/line";
import { startVote } from "@/services/trip-state";
import { track } from "@/lib/analytics";
import { buildVoteCarousel, buildWinnerMessage } from "./flex";
import { getVoteTally } from "@/services/vote";
import type { ItemType } from "@/lib/types";
import { inferItemType } from "@/bot/commands/add";
import { searchPlaces } from "./places";
import { getKnowledgeEntries } from "@/services/memory";
import { appendTripLinkText, buildTripUrl, getTripUrlForItem } from "@/lib/trip-link";

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
 *   1. Validate that the anchor item is an explicit decision item
 *   2. Seed options from remembered knowledge into the decision item
 *   3. Fall back to external discovery only when knowledge is thin
 *   4. Move anchor item to pending (startVote)
 *   5. Build and push Flex Message carousel
 */
export async function startDecision(input: StartDecisionInput): Promise<void> {
  const { itemId, tripId, groupId, lineGroupId } = input;
  const db = createAdminClient();
  const boardUrl = buildTripUrl(tripId);
  const votesUrl = buildTripUrl(tripId, "/votes");

  const { data: item } = await db
    .from("trip_items")
    .select("id, title, item_type, item_kind, stage")
    .eq("id", itemId)
    .single();

  if (!item) {
    console.warn(`[decisions] Item ${itemId} not found`);
    await pushText(
      lineGroupId,
      appendTripLinkText("找不到這個項目。使用 /status 查看看板。", boardUrl)
    );
    return;
  }

  const resolvedType: ItemType =
    item.item_type && item.item_type !== "other"
      ? (item.item_type as ItemType)
      : inferItemType(item.title);

  console.log(`[decisions] Starting vote for "${item.title}" (type: ${resolvedType}) in group ${lineGroupId}`);

  if (item.item_kind !== "decision") {
    await pushText(
      lineGroupId,
      appendTripLinkText(
        `「${item.title}」是知識或規劃內容，不是決定項目。\n請先建立決定項目，再開始投票。`,
        boardUrl
      )
    );
    return;
  }

  if (item.stage !== "todo") {
    await pushText(
      lineGroupId,
      appendTripLinkText(
        `「${item.title}」已經是「${item.stage}」階段。使用 /status 查看看板。`,
        boardUrl
      )
    );
    return;
  }

  const { data: existingOptions } = await db
    .from("trip_item_options")
    .select("id")
    .eq("trip_item_id", itemId);

  if (!existingOptions?.length) {
    const knowledgeEntries = await getKnowledgeEntries(tripId, resolvedType);
    if (knowledgeEntries.length > 0) {
      const { error: importError } = await db.from("trip_item_options").insert(
        knowledgeEntries.map((entry) => ({
          trip_item_id: itemId,
          provider: "manual" as const,
          name: entry.title,
          image_url: entry.imageUrl,
          rating: entry.rating,
          price_level: entry.priceLevel,
          address: entry.address,
          booking_url: entry.bookingUrl,
          metadata_json: {
            memory_id: entry.id,
            summary: entry.summary,
            mention_count: entry.mentionCount,
            source: "trip_memory",
          },
        }))
      );

      if (importError) {
        console.error("[decisions] failed to import knowledge options", importError);
      }
    }
  }

  let { data: allOptions } = await db
    .from("trip_item_options")
    .select("id, name, image_url, rating, price_level, address, booking_url")
    .eq("trip_item_id", itemId);

  if (!allOptions?.length) {
    const placesResult = await searchPlaces(input.destination, resolvedType);

    if (placesResult.candidates.length > 0) {
      const { error: insertError } = await db.from("trip_item_options").insert(
        placesResult.candidates.map((candidate) => ({
          trip_item_id: itemId,
          provider: "google_places" as const,
          external_ref: candidate.placeId,
          name: candidate.name,
          image_url: candidate.photoUrl,
          rating: candidate.rating,
          price_level: candidate.priceLevel,
          address: candidate.address,
          booking_url: candidate.bookingUrl,
          metadata_json: { source: "places_search" },
        }))
      );

      if (insertError) {
        console.error("[decisions] failed to insert Places candidates", insertError);
      } else {
        const refreshed = await db
          .from("trip_item_options")
          .select("id, name, image_url, rating, price_level, address, booking_url")
          .eq("trip_item_id", itemId);
        allOptions = refreshed.data ?? [];
      }
    }

    if (!allOptions?.length) {
      console.log(`[decisions] No knowledge or search options found for "${item.title}" - item stays in todo`);
      if (placesResult.errorKind === "no_results") {
        await pushText(
          lineGroupId,
          appendTripLinkText(
            `${input.destination}目前找不到「${item.title}」的地點。\n\n` +
              `請大家分享想法，或用 /share [網址] 分享連結，再試一次 /vote。`,
            boardUrl
          )
        );
      } else {
        await pushText(
          lineGroupId,
          appendTripLinkText(
            `目前無法為「${item.title}」搜尋地點。\n\n` +
              `請大家分享想法，或用 /share [網址] 分享連結，再試一次 /vote。`,
            boardUrl
          )
        );
      }
      return;
    }
  }

  console.log(`[decisions] Found ${allOptions.length} option(s). Starting vote...`);

  const deadline = new Date(Date.now() + VOTE_DURATION_HOURS * 60 * 60 * 1000).toISOString();
  const transition = await startVote(itemId, deadline);
  if (!transition.ok) {
    await pushText(
      lineGroupId,
      appendTripLinkText(`無法開始投票：${transition.error}`, votesUrl)
    );
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
    appendTripLinkText(
      `「${item.title}」已開始投票！\n滑動比較選項，再按下「投票」。將於 ${VOTE_DURATION_HOURS} 小時後截止。`,
      votesUrl
    )
  );
  await pushFlex(lineGroupId, `投票：${item.title}`, carousel);
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
  await pushFlex(lineGroupId, `投票：${item.title}`, carousel);
}

/**
 * Announce the vote winner, then — if the confirmed item requires booking —
 * send a follow-up prompt with the winning option's booking URL.
 * Callers must pass the pre-computed vote counts - no re-fetch needed.
 */
export async function announceWinner(
  itemId: string,
  winningOptionId: string,
  lineGroupId: string,
  winnerVotes: number,
  totalVotes: number
): Promise<void> {
  const db = createAdminClient();

  const [{ data: option }, { data: item }, tripUrl] = await Promise.all([
    db
      .from("trip_item_options")
      .select("name, booking_url")
      .eq("id", winningOptionId)
      .single(),
    db
      .from("trip_items")
      .select("title, booking_status")
      .eq("id", itemId)
      .single(),
    getTripUrlForItem(itemId),
  ]);

  await pushText(
    lineGroupId,
    appendTripLinkText(
      buildWinnerMessage(
        item?.title ?? "項目",
        option?.name ?? "選定的選項",
        winnerVotes,
        totalVotes
      ),
      tripUrl
    )
  );

  // If this item type requires booking, prompt the group to complete it
  if (item?.booking_status === "needed") {
    const bookingLine = option?.booking_url
      ? `\n\n預訂連結：${option.booking_url}`
      : "";
    await pushText(
      lineGroupId,
      appendTripLinkText(
        `📋 下一步：完成「${item.title}」的預訂。${bookingLine}\n\n預訂完成後，請輸入：\n/booked ${item.title} [訂位代碼]`,
        tripUrl
      )
    );

    await track("booking_prompt_sent", {
      properties: {
        item_id: itemId,
        has_booking_url: !!option?.booking_url,
      },
    });
  }
}

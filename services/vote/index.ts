import { createAdminClient } from "@/lib/db";
import { validateActiveMember } from "@/lib/members";
import { confirmItem } from "@/services/trip-state";
import { track } from "@/lib/analytics";
import { getPlaceDetails } from "@/services/decisions/places";

export interface CastVoteInput {
  tripItemId: string;
  optionId: string;
  groupId: string;
  lineUserId: string;
}

export interface VoteResult {
  accepted: boolean;
  error?: string;
  tally: Map<string, number>;
  totalVotes: number;
  majority: MajorityResult;
}

export interface MajorityResult {
  reached: boolean;
  winningOptionId: string | null;
  winningCount: number;
}

/**
 * Record or overwrite a user's vote for a decision item.
 * Uses upsert to atomically replace a prior vote from the same user.
 */
export async function castVote(input: CastVoteInput): Promise<VoteResult> {
  const db = createAdminClient();

  // Verify item is still pending
  const { data: item } = await db
    .from("trip_items")
    .select("id, stage, trip_id")
    .eq("id", input.tripItemId)
    .single();

  if (!item || item.stage !== "pending") {
    return {
      accepted: false,
      error: "Voting is no longer open for this item",
      tally: new Map(),
      totalVotes: 0,
      majority: { reached: false, winningOptionId: null, winningCount: 0 },
    };
  }

  // Verify optionId belongs to this item (prevents cross-item vote injection)
  const { data: option } = await db
    .from("trip_item_options")
    .select("id")
    .eq("id", input.optionId)
    .eq("trip_item_id", input.tripItemId)
    .single();

  if (!option) {
    return {
      accepted: false,
      error: "Invalid option for this item",
      tally: new Map(),
      totalVotes: 0,
      majority: { reached: false, winningOptionId: null, winningCount: 0 },
    };
  }

  if (!await validateActiveMember(db, input.groupId, input.lineUserId)) {
    return {
      accepted: false,
      error: "You are not a member of this group",
      tally: new Map(),
      totalVotes: 0,
      majority: { reached: false, winningOptionId: null, winningCount: 0 },
    };
  }

  // Upsert vote — replaces any prior vote by this user for this item
  const { error } = await db.from("votes").upsert(
    {
      trip_item_id: input.tripItemId,
      option_id: input.optionId,
      group_id: input.groupId,
      line_user_id: input.lineUserId,
      cast_at: new Date().toISOString(),
    },
    { onConflict: "trip_item_id,line_user_id" }
  );

  if (error) {
    return {
      accepted: false,
      error: "Failed to record vote",
      tally: new Map(),
      totalVotes: 0,
      majority: { reached: false, winningOptionId: null, winningCount: 0 },
    };
  }

  await track("vote_cast", {
    groupId: input.groupId,
    userId: input.lineUserId,
    properties: { item_id: input.tripItemId, option_id: input.optionId },
  });

  // Compute current tally
  const { data: allVotes } = await db
    .from("votes")
    .select("option_id")
    .eq("trip_item_id", input.tripItemId);

  const tally = buildTally(allVotes ?? []);
  const totalVotes = allVotes?.length ?? 0;

  // Check majority against active group member count
  const { count: memberCount } = await db
    .from("group_members")
    .select("*", { count: "exact", head: true })
    .eq("group_id", input.groupId)
    .is("left_at", null);

  const majority = checkMajority(tally, totalVotes, memberCount ?? totalVotes);

  return { accepted: true, tally, totalVotes, majority };
}

/**
 * Close a vote by confirming the winning option.
 * Returns { closed: true } if this call performed the close, or
 * { closed: false } if the item was already confirmed by a concurrent request.
 */
export async function closeVote(
  tripItemId: string,
  winningOptionId: string,
  groupId: string,
  totalVotes: number
): Promise<{ closed: boolean }> {
  const result = await confirmItem(tripItemId, winningOptionId);

  if (result.ok === false && result.code === "ALREADY_CONFIRMED") {
    // Another concurrent request already closed this vote — skip analytics/announce
    return { closed: false };
  }

  if (!result.ok) {
    console.error("[vote] closeVote: confirmItem failed", result);
    return { closed: false };
  }

  await enrichConfirmedGooglePlaceOption(winningOptionId);

  await track("vote_completed", {
    groupId,
    properties: {
      item_id: tripItemId,
      winning_option_id: winningOptionId,
      total_votes: totalVotes,
    },
  });

  return { closed: true };
}

/**
 * Fetch the current vote tally for a pending item.
 * Returns map of optionId → count.
 */
export async function getVoteTally(
  tripItemId: string
): Promise<Map<string, number>> {
  const db = createAdminClient();
  const { data } = await db
    .from("votes")
    .select("option_id")
    .eq("trip_item_id", tripItemId);
  return buildTally(data ?? []);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildTally(votes: { option_id: string }[]): Map<string, number> {
  const tally = new Map<string, number>();
  for (const v of votes) {
    tally.set(v.option_id, (tally.get(v.option_id) ?? 0) + 1);
  }
  return tally;
}

function checkMajority(
  tally: Map<string, number>,
  totalVotes: number,
  groupSize: number
): MajorityResult {
  if (totalVotes === 0) {
    return { reached: false, winningOptionId: null, winningCount: 0 };
  }

  const threshold = groupSize / 2;
  let winningOptionId: string | null = null;
  let winningCount = 0;

  for (const [optionId, count] of tally) {
    if (count > threshold && count > winningCount) {
      winningOptionId = optionId;
      winningCount = count;
    }
  }

  return {
    reached: winningOptionId !== null,
    winningOptionId,
    winningCount,
  };
}

async function enrichConfirmedGooglePlaceOption(optionId: string): Promise<void> {
  const db = createAdminClient();

  const { data: option } = await db
    .from("trip_item_options")
    .select("id, provider, external_ref, name, address, image_url, rating, price_level, metadata_json, google_maps_url, photo_name, lat, lng")
    .eq("id", optionId)
    .single();

  if (!option || option.provider !== "google_places" || !option.external_ref) {
    return;
  }

  const details = await getPlaceDetails(option.external_ref);
  if (!details) {
    return;
  }

  const existingMetadata =
    option.metadata_json && typeof option.metadata_json === "object"
      ? (option.metadata_json as Record<string, unknown>)
      : {};

  const patch: Record<string, unknown> = {
    name: details.name || option.name,
    address: details.address ?? option.address ?? null,
    image_url: details.photoUrl ?? option.image_url ?? null,
    rating: details.rating ?? option.rating ?? null,
    price_level: details.priceLevel ?? option.price_level ?? null,
    google_maps_url: details.googleMapsUrl ?? option.google_maps_url ?? null,
    photo_name: details.photoName ?? option.photo_name ?? null,
    lat: details.lat ?? option.lat ?? null,
    lng: details.lng ?? option.lng ?? null,
    source_last_synced_at: new Date().toISOString(),
    metadata_json: {
      ...existingMetadata,
      source: existingMetadata.source ?? "places_search",
      google_maps_uri: details.googleMapsUrl,
      enriched_from_place_details: true,
      enriched_at: new Date().toISOString(),
    },
  };

  const { error } = await db
    .from("trip_item_options")
    .update(patch)
    .eq("id", optionId);

  if (error) {
    console.error("[vote] failed to enrich confirmed Google place option", error);
  }
}

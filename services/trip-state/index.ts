import { createAdminClient } from "@/lib/db";
import type { ItemKind, ItemStage, ItemType, ItemSource, TripItem, BookingStatus } from "@/lib/types";
import { BOOKABLE_ITEM_TYPES } from "@/lib/types";

export interface CreateItemInput {
  tripId: string;
  title: string;
  itemType?: ItemType;
  itemKind?: ItemKind;
  description?: string;
  source?: ItemSource;
  deadlineAt?: string;
}

export interface UpdateItemInput {
  title?: string;
  description?: string;
  itemType?: ItemType;
  deadlineAt?: string | null;
  assignedToLineUserId?: string | null;
}

export type TransitionResult =
  | { ok: true; item: TripItem }
  | { ok: false; error: string; code: string };

/**
 * Create a new To-Do board item for a trip.
 */
export async function createItem(input: CreateItemInput): Promise<TransitionResult> {
  const db = createAdminClient();

  const { data, error } = await db
    .from("trip_items")
    .insert({
      trip_id: input.tripId,
      title: input.title,
      item_type: input.itemType ?? "other",
      item_kind: input.itemKind ?? "task",
      description: input.description ?? null,
      stage: "todo",
      source: input.source ?? "manual",
      deadline_at: input.deadlineAt ?? null,
    })
    .select("*")
    .single();

  if (error || !data) {
    return { ok: false, error: "Failed to create item", code: "DB_ERROR" };
  }
  return { ok: true, item: data as TripItem };
}

/**
 * Update mutable fields on a board item (title, description, type, deadline).
 * Does not touch stage — use transition functions for that.
 */
export async function updateItem(
  itemId: string,
  input: UpdateItemInput
): Promise<TransitionResult> {
  const db = createAdminClient();

  const patch: Record<string, unknown> = {};
  if (input.title !== undefined) patch.title = input.title;
  if (input.description !== undefined) patch.description = input.description;
  if (input.itemType !== undefined) patch.item_type = input.itemType;
  if (input.deadlineAt !== undefined) patch.deadline_at = input.deadlineAt;
  if (input.assignedToLineUserId !== undefined) patch.assigned_to_line_user_id = input.assignedToLineUserId;

  const { data, error } = await db
    .from("trip_items")
    .update(patch)
    .eq("id", itemId)
    .select("*")
    .single();

  if (error || !data) {
    return { ok: false, error: "Failed to update item", code: "DB_ERROR" };
  }
  return { ok: true, item: data as TripItem };
}

/**
 * Soft-delete: move item back to todo and clear confirmed option.
 * Hard delete is not exposed to prevent accidental data loss.
 */
export async function deleteItem(itemId: string): Promise<{ ok: boolean; error?: string }> {
  const db = createAdminClient();
  const { error } = await db.from("trip_items").delete().eq("id", itemId);
  if (error) return { ok: false, error: "Failed to delete item" };
  return { ok: true };
}

/**
 * Move a todo item to pending (open for voting).
 * Validates the item exists and is currently in todo stage.
 */
export async function startVote(
  itemId: string,
  deadlineAt: string
): Promise<TransitionResult> {
  const db = createAdminClient();

  const { data: item } = await db
    .from("trip_items")
    .select("id, stage")
    .eq("id", itemId)
    .single();

  if (!item) {
    return { ok: false, error: "Item not found", code: "NOT_FOUND" };
  }
  if (item.stage !== "todo") {
    return {
      ok: false,
      error: `Item is already ${item.stage} — cannot start a vote`,
      code: "INVALID_TRANSITION",
    };
  }

  const { data, error } = await db
    .from("trip_items")
    .update({ stage: "pending" as ItemStage, deadline_at: deadlineAt })
    .eq("id", itemId)
    .select("*")
    .single();

  if (error || !data) {
    return { ok: false, error: "Failed to move item to pending", code: "DB_ERROR" };
  }
  return { ok: true, item: data as TripItem };
}

/**
 * Confirm an item with a winning option.
 * Atomic: the UPDATE only matches rows where stage is not already confirmed,
 * so concurrent calls cannot double-fire — the second caller gets ALREADY_CONFIRMED.
 *
 * Also sets booking_status automatically:
 *   - 'needed'       for bookable item types (hotel, restaurant, activity, transport, flight)
 *   - 'not_required' for all others (insurance, other, task items)
 */
export async function confirmItem(
  itemId: string,
  confirmedOptionId: string
): Promise<TransitionResult> {
  const db = createAdminClient();

  // Pre-fetch item_type to determine booking_status.
  // item_type is immutable so this is safe to read before the atomic update.
  const { data: existing } = await db
    .from("trip_items")
    .select("id, item_type, stage")
    .eq("id", itemId)
    .single();

  if (!existing) {
    return { ok: false, error: "Item not found", code: "NOT_FOUND" };
  }
  if (existing.stage === "confirmed") {
    return { ok: false, error: "Item is already confirmed", code: "ALREADY_CONFIRMED" };
  }

  const bookingStatus: BookingStatus = BOOKABLE_ITEM_TYPES.includes(
    existing.item_type as ItemType
  )
    ? "needed"
    : "not_required";

  const { data, error } = await db
    .from("trip_items")
    .update({
      stage: "confirmed" as ItemStage,
      confirmed_option_id: confirmedOptionId,
      deadline_at: null,
      booking_status: bookingStatus,
    })
    .eq("id", itemId)
    .in("stage", ["todo", "pending"] as ItemStage[])
    .select("*")
    .single();

  // PGRST116 = 0 rows returned — concurrent confirm beat us to it
  if (error?.code === "PGRST116") {
    return { ok: false, error: "Item is already confirmed", code: "ALREADY_CONFIRMED" };
  }

  if (error || !data) {
    return { ok: false, error: "Failed to confirm item", code: "DB_ERROR" };
  }
  return { ok: true, item: data as TripItem };
}

export interface ConfirmBookingInput {
  itemId: string;
  bookingRef: string;
  bookedByLineUserId: string;
}

/**
 * Record that a confirmed decision item has been booked.
 * Only applies to items with booking_status = 'needed'.
 * Returns the updated item on success.
 */
export async function confirmBooking(
  input: ConfirmBookingInput
): Promise<TransitionResult> {
  const db = createAdminClient();

  const { data: item } = await db
    .from("trip_items")
    .select("id, stage, booking_status, title")
    .eq("id", input.itemId)
    .single();

  if (!item) {
    return { ok: false, error: "Item not found", code: "NOT_FOUND" };
  }
  if (item.stage !== "confirmed") {
    return {
      ok: false,
      error: "Only confirmed items can be marked as booked",
      code: "INVALID_STAGE",
    };
  }
  if (item.booking_status === "not_required") {
    return {
      ok: false,
      error: "This item does not require a booking",
      code: "NOT_BOOKABLE",
    };
  }
  if (item.booking_status === "booked") {
    return { ok: false, error: "Item is already marked as booked", code: "ALREADY_BOOKED" };
  }

  const { data, error } = await db
    .from("trip_items")
    .update({
      booking_status: "booked" as BookingStatus,
      booking_ref: input.bookingRef,
      booked_by_line_user_id: input.bookedByLineUserId,
      booked_at: new Date().toISOString(),
    })
    .eq("id", input.itemId)
    .select("*")
    .single();

  if (error || !data) {
    return { ok: false, error: "Failed to update booking status", code: "DB_ERROR" };
  }
  return { ok: true, item: data as TripItem };
}

/**
 * Reopen a confirmed or pending item back to todo.
 * Clears confirmed_option and deadline.
 */
export async function reopenItem(itemId: string): Promise<TransitionResult> {
  const db = createAdminClient();

  const { data, error } = await db
    .from("trip_items")
    .update({
      stage: "todo" as ItemStage,
      confirmed_option_id: null,
      deadline_at: null,
      status_reason: null,
      tie_extension_count: 0,
    })
    .eq("id", itemId)
    .select("*")
    .single();

  if (error || !data) {
    return { ok: false, error: "Failed to reopen item", code: "DB_ERROR" };
  }
  return { ok: true, item: data as TripItem };
}

/**
 * Fetch the active trip for a group, or null if none.
 */
export async function getActiveTrip(groupId: string) {
  const db = createAdminClient();
  const { data } = await db
    .from("trips")
    .select("*")
    .eq("group_id", groupId)
    .in("status", ["draft", "active"])
    .single();
  return data ?? null;
}

export interface AddOptionInput {
  itemId: string;
  name: string;
}

export type AddOptionResult =
  | { ok: true; optionId: string; name: string }
  | { ok: false; error: string; code: string };

/**
 * Manually add a voteable option to a decision item.
 * The item must be a decision in todo or pending stage.
 */
export async function addOption(input: AddOptionInput): Promise<AddOptionResult> {
  const db = createAdminClient();

  const { data: item } = await db
    .from("trip_items")
    .select("id, item_kind, stage")
    .eq("id", input.itemId)
    .single();

  if (!item) {
    return { ok: false, error: "Item not found", code: "NOT_FOUND" };
  }
  if (item.item_kind !== "decision") {
    return { ok: false, error: "Item is not a decision item", code: "WRONG_KIND" };
  }
  if (item.stage === "confirmed") {
    return { ok: false, error: "Item is already confirmed", code: "ALREADY_CONFIRMED" };
  }

  // Reject exact-name duplicates (case-insensitive)
  const { data: existing } = await db
    .from("trip_item_options")
    .select("id")
    .eq("trip_item_id", input.itemId)
    .ilike("name", input.name)
    .limit(1)
    .single();

  if (existing) {
    return { ok: false, error: "Option already exists", code: "DUPLICATE" };
  }

  const { data, error } = await db
    .from("trip_item_options")
    .insert({
      trip_item_id: input.itemId,
      provider: "manual",
      name: input.name,
    })
    .select("id")
    .single();

  if (error || !data) {
    return { ok: false, error: "Failed to add option", code: "DB_ERROR" };
  }
  return { ok: true, optionId: data.id, name: input.name };
}

/**
 * Fetch a single board item with its options.
 */
export async function getItemWithOptions(itemId: string) {
  const db = createAdminClient();
  const { data } = await db
    .from("trip_items")
    .select("*, trip_item_options(*)")
    .eq("id", itemId)
    .single();
  return data ?? null;
}

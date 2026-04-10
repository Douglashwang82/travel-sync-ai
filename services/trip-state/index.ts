import { createAdminClient } from "@/lib/db";
import type { ItemKind, ItemStage, ItemType, ItemSource, TripItem } from "@/lib/types";

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
 */
export async function confirmItem(
  itemId: string,
  confirmedOptionId: string
): Promise<TransitionResult> {
  const db = createAdminClient();

  const { data, error } = await db
    .from("trip_items")
    .update({
      stage: "confirmed" as ItemStage,
      confirmed_option_id: confirmedOptionId,
      deadline_at: null,
    })
    .eq("id", itemId)
    .in("stage", ["todo", "pending"] as ItemStage[])
    .select("*")
    .single();

  // PGRST116 = 0 rows returned — either not found or already confirmed
  if (error?.code === "PGRST116") {
    const { data: existing } = await db
      .from("trip_items")
      .select("id, stage")
      .eq("id", itemId)
      .single();
    if (!existing) return { ok: false, error: "Item not found", code: "NOT_FOUND" };
    return { ok: false, error: "Item is already confirmed", code: "ALREADY_CONFIRMED" };
  }

  if (error || !data) {
    return { ok: false, error: "Failed to confirm item", code: "DB_ERROR" };
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

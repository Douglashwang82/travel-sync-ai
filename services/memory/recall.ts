/**
 * Cross-trip semantic recall over trip_memories.
 *
 * "places like Tatami in Kyoto" → embed the query → match_trip_memories RPC
 * scoped to the requesting user's group memberships → top-K candidates.
 *
 * Backfill: trip_memories rows written before the embedding column was added
 * have NULL embeddings. Call backfillMemoryEmbeddings() in a one-shot script
 * (scripts/backfill-memory-embeddings.ts — TODO: not yet written) to fill
 * them in. Going forward, rememberPlace() in ./index.ts should also write
 * the embedding when inserting/updating — wire it up when this feature
 * actually ships to users.
 */

import { createAdminClient } from "@/lib/db";
import { generateEmbedding } from "@/lib/gemini";
import { captureError } from "@/lib/monitoring";

export interface RecallHit {
  id: string;
  tripId: string;
  groupId: string;
  itemType: string;
  title: string;
  address: string | null;
  similarity: number;
}

export interface RecallOptions {
  /** LINE user id whose group memberships scope the search. */
  lineUserId: string;
  /** Free-text query, e.g. "cozy ramen in tokyo". */
  query: string;
  /** Max results. Defaults to 8. */
  limit?: number;
}

export async function recallSimilarPlaces(opts: RecallOptions): Promise<RecallHit[]> {
  const db = createAdminClient();
  const { data: memberships } = await db
    .from("group_members")
    .select("group_id")
    .eq("line_user_id", opts.lineUserId)
    .is("left_at", null);
  const groupIds = (memberships ?? []).map((m) => m.group_id as string);
  if (groupIds.length === 0) return [];

  let embedding: number[];
  try {
    embedding = await generateEmbedding(opts.query);
  } catch (err) {
    captureError(err, { context: "recall_embed_failed", query: opts.query });
    return [];
  }

  const { data, error } = await db.rpc("match_trip_memories", {
    query_embedding: embedding as unknown as string,
    match_count: opts.limit ?? 8,
    group_ids: groupIds,
  });
  if (error) {
    captureError(error, { context: "recall_rpc_failed" });
    return [];
  }
  const rows = (data ?? []) as Array<{
    id: string;
    trip_id: string;
    group_id: string;
    item_type: string;
    title: string;
    address: string | null;
    similarity: number;
  }>;
  return rows.map((r) => ({
    id: r.id,
    tripId: r.trip_id,
    groupId: r.group_id,
    itemType: r.item_type,
    title: r.title,
    address: r.address,
    similarity: r.similarity,
  }));
}

/**
 * Backfill embeddings for trip_memories rows that don't have one yet.
 * Run from a one-shot script after the migration; safe to re-run (idempotent).
 */
export async function backfillMemoryEmbeddings(batchSize = 50): Promise<{ processed: number }> {
  const db = createAdminClient();
  let processed = 0;
  while (true) {
    const { data: rows } = await db
      .from("trip_memories")
      .select("id, title, summary, address")
      .is("embedding", null)
      .limit(batchSize);
    if (!rows || rows.length === 0) break;

    for (const row of rows) {
      const text = [row.title, row.summary, row.address].filter(Boolean).join(" — ");
      try {
        const embedding = await generateEmbedding(text);
        await db
          .from("trip_memories")
          .update({ embedding: embedding as unknown as string })
          .eq("id", row.id as string);
        processed++;
      } catch (err) {
        captureError(err, { context: "backfill_embed_failed", id: row.id });
      }
    }
  }
  return { processed };
}

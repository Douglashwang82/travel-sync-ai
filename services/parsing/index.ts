import { createAdminClient } from "@/lib/db";
import { track } from "@/lib/analytics";
import { checkRelevance } from "./relevance";
import { assembleTripContext } from "./context";
import { extractEntities } from "./extractor";
import { persistConflicts } from "./conflict";
import { applyParseResult } from "./item-generator";

export interface ParseMessageInput {
  messageText: string;
  groupId: string;
  lineEventId: string;
  lineUserId?: string;
}

/**
 * Full parsing pipeline for a single group chat message.
 *
 * Steps:
 *   1. Relevance filter — fast rules-based check
 *   2. Context assembly — fetch trip + recent entities
 *   3. LLM extraction — Gemini structured output
 *   4. Confidence gate — drop low-confidence entities
 *   5. Persist entities + apply trip updates / create board items
 *   6. Persist conflicts as Pending board items
 *   7. Track analytics
 *
 * Never throws — all errors are caught and logged so they don't
 * take down the event-processor.
 */
export async function parseMessage(input: ParseMessageInput): Promise<void> {
  const { messageText, groupId, lineEventId, lineUserId } = input;
  console.log(`[parsing] Starting pipeline for group ${groupId}...`);

  // ── 0. Optout check ────────────────────────────────────────────────────────
  if (lineUserId) {
    const db = createAdminClient();
    const { data: member } = await db
      .from("group_members")
      .select("optout_at")
      .eq("group_id", groupId)
      .eq("line_user_id", lineUserId)
      .single();
    if (member?.optout_at) {
      console.log(`[parsing] User ${lineUserId} has opted out. Skipping.`);
      return;
    }
  }

  // ── 1. Relevance filter ────────────────────────────────────────────────────
  const relevanceResult = checkRelevance(messageText);
  if (!relevanceResult.relevant) {
    console.log(`[parsing] Message categorized as IRRELEVANT (${relevanceResult.reason}): "${messageText.substring(0, 20)}..."`);
    return;
  }
  console.log(`[parsing] Message is RELEVANT (${relevanceResult.reason}). Continuing...`);

  // ── 2. Context assembly ────────────────────────────────────────────────────
  const ctx = await assembleTripContext(groupId);
  if (!ctx) {
    console.warn(`[parsing] No active trip context found for group: ${groupId}. Drop message parsing.`);
    return;
  }
  console.log(`[parsing] Active trip found: ${ctx.destination} (${ctx.tripId})`);

  // ── 3 + 4. LLM extraction with confidence gate ────────────────────────────
  const parseResult = await extractEntities(messageText, ctx);
  if (!parseResult.relevant) {
    console.log(`[parsing] AI extractor determined message is NOT truly relevant.`);
    return;
  }
  console.log(`[parsing] AI extracted ${parseResult.entities.length} entities and ${parseResult.suggestedActions.length} actions.`);

  // ── 5. Persist entities + apply actions ───────────────────────────────────
  try {
    await applyParseResult(
      ctx.tripId,
      groupId,
      lineEventId,
      parseResult.entities,
      parseResult.suggestedActions
    );
    console.log(`[parsing] Successfully persisted items to board!`);
  } catch (err) {
    console.error("[parsing] applyParseResult failed", { lineEventId, err });
  }

  // ── 6. Persist conflicts ───────────────────────────────────────────────────
  if (parseResult.conflicts.length > 0) {
    console.log(`[parsing] Found ${parseResult.conflicts.length} conflicts!`);
    try {
      await persistConflicts(
        ctx.tripId,
        groupId,
        lineEventId,
        parseResult.conflicts
      );
    } catch (err) {
      console.error("[parsing] persistConflicts failed", { lineEventId, err });
    }
  }

  // ── 7. Analytics ───────────────────────────────────────────────────────────
  for (const entity of parseResult.entities) {
    await track("message_parsed", {
      groupId,
      properties: {
        entity_type: entity.type,
        confidence_score: entity.confidence,
        line_event_id: lineEventId,
      },
    }).catch(() => {});
  }
}

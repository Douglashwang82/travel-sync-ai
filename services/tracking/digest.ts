// ─────────────────────────────────────────────────────────────────────────────
// Tracking List — daily digest composer
//
// After all runners finish, compose one digest per user:
//   - Pull today's new tracking_items grouped by list
//   - Ask Gemini for a short markdown summary (bullet list, Chinese + source)
//   - Persist to tracking_digests
//   - Deliver via lib/line.ts pushText / pushFlex to the user's active group
//     (fallback to 1:1 DM if no active group)
// ─────────────────────────────────────────────────────────────────────────────

export interface DigestResult {
  line_user_id: string;
  item_count: number;
  delivered: boolean;
}

export async function composeAndSendDigest(
  _lineUserId: string
): Promise<DigestResult> {
  // TODO: SELECT item ids WHERE first_seen_at::date = today AND list.user = X;
  // call generateText() with a compact prompt; insert tracking_digests;
  // pushText(lineUserId, summary). Respect rate_limit_windows.
  throw new Error("composeAndSendDigest: not implemented");
}

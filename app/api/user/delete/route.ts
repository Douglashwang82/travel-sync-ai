import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/db";
import { logger } from "@/lib/logger";

const BodySchema = z.object({
  lineUserId: z.string().min(1),
  confirmPhrase: z.literal("DELETE MY DATA"),
});

/**
 * POST /api/user/delete
 *
 * Deletes all personal data for a LINE user across all groups and trips.
 * Requires an explicit confirmation phrase to prevent accidental deletion.
 *
 * This endpoint is called either by the bot (/delete-my-data command) or by
 * users who email support and request manual deletion.
 *
 * Cascade strategy:
 *   - group_members: soft-delete by setting left_at + anonymise display_name
 *   - parsed_entities, analytics_events, optout_list: hard-delete rows
 *   - travel_documents: hard-delete rows for this user
 *   - packing_checks: hard-delete rows for this user
 *   - expenses: anonymise paid_by_display_name (keep amounts for group balance)
 *   - trip_ideas: hard-delete rows submitted by this user
 *
 * Note: we retain anonymised expense records to preserve group balance integrity.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Provide lineUserId and confirmPhrase: 'DELETE MY DATA'",
        details: parsed.error.flatten(),
      },
      { status: 400 }
    );
  }

  const { lineUserId } = parsed.data;
  const db = createAdminClient();

  logger.info("user delete request received", { userId: lineUserId });

  try {
    // 1. Anonymise group_members rows (keep for group history integrity)
    await db
      .from("group_members")
      .update({ display_name: "[deleted]", left_at: new Date().toISOString() })
      .eq("line_user_id", lineUserId)
      .is("left_at", null);

    // 2. Hard-delete parsed_entities attributed to this user
    await db
      .from("parsed_entities")
      .delete()
      .contains("attributes_json", { line_user_id: lineUserId });

    // 3. Hard-delete analytics events for this user
    await db.from("analytics_events").delete().eq("user_id", lineUserId);

    // 4. Remove from optout list
    await db.from("optout_list").delete().eq("line_user_id", lineUserId);

    // 5. Hard-delete travel documents
    await db.from("travel_documents").delete().eq("line_user_id", lineUserId);

    // 6. Hard-delete packing checks
    await db.from("packing_checks").delete().eq("line_user_id", lineUserId);

    // 7. Anonymise expense payer name (keep amounts for balance integrity)
    await db
      .from("expenses")
      .update({ paid_by_display_name: "[deleted]" })
      .eq("paid_by_line_user_id", lineUserId);

    // 8. Hard-delete trip ideas submitted by this user
    await db.from("trip_ideas").delete().eq("submitted_by", lineUserId);

    // 9. Remove packing items added by this user
    await db.from("packing_items").delete().eq("added_by", lineUserId);

    logger.info("user data deleted successfully", { userId: lineUserId });

    return NextResponse.json({
      status: "deleted",
      lineUserId,
      message:
        "Your personal data has been removed. Anonymised records may be retained to preserve group expense history.",
    });
  } catch (err) {
    logger.error("user delete failed", { userId: lineUserId });
    console.error("[user/delete] error:", err);
    return NextResponse.json({ error: "Deletion failed. Please try again." }, { status: 500 });
  }
}

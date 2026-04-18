import type { CommandContext } from "../router";

/**
 * /delete-my-data
 *
 * Triggers a full personal data deletion for the calling user.
 * Anonymises group_members and travel documents; hard-deletes personal records.
 */
export async function handleDeleteMyData(
  ctx: CommandContext,
  reply: (text: string) => Promise<void>
): Promise<void> {
  if (!ctx.userId) {
    await reply("I couldn't identify your account. Please try again inside a group chat.");
    return;
  }

  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_APP_URL ?? ""}/api/user/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lineUserId: ctx.userId, confirmPhrase: "DELETE MY DATA" }),
    });

    if (!res.ok) {
      throw new Error(`delete API returned ${res.status}`);
    }

    await reply(
      "✅ Your personal data has been deleted from TravelSync AI.\n\n" +
        "Anonymised expense records may be retained to preserve your group's balance history.\n\n" +
        "If you have further questions, contact privacy@travelsync.ai"
    );
  } catch {
    await reply(
      "Something went wrong deleting your data. Please email privacy@travelsync.ai and we will process your request within 30 days."
    );
  }
}

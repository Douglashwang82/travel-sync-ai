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
    await reply("無法辨識你的帳號，請在群組聊天中再試一次。");
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
      "✅ 你的個人資料已從 TravelSync AI 刪除。\n\n" +
        "為了維持群組結餘歷史，已匿名化的費用紀錄可能仍會保留。\n\n" +
        "如有其他問題，請聯絡 privacy@travelsync.ai"
    );
  } catch {
    await reply(
      "刪除資料時發生問題，請來信 privacy@travelsync.ai，我們會在 30 天內處理你的請求。"
    );
  }
}

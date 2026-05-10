import { createAdminClient } from "@/lib/db";
import type { CommandContext } from "../router";

export async function handleOptout(
  ctx: CommandContext,
  reply: (text: string) => Promise<void>
): Promise<void> {
  if (!ctx.dbGroupId || !ctx.userId) {
    await reply("無法辨識你的身分，請再試一次。");
    return;
  }

  const db = createAdminClient();

  await db
    .from("group_members")
    .upsert(
      {
        group_id: ctx.dbGroupId,
        line_user_id: ctx.userId,
        optout_at: new Date().toISOString(),
      },
      { onConflict: "group_id,line_user_id" }
    );

  await reply(
    "完成。我不會再解析你的訊息來協助旅程規劃。\n" +
      "想重新啟用的話，隨時輸入 /optin 即可。"
  );
}

export async function handleOptin(
  ctx: CommandContext,
  reply: (text: string) => Promise<void>
): Promise<void> {
  if (!ctx.dbGroupId || !ctx.userId) {
    await reply("無法辨識你的身分，請再試一次。");
    return;
  }

  const db = createAdminClient();

  await db
    .from("group_members")
    .upsert(
      {
        group_id: ctx.dbGroupId,
        line_user_id: ctx.userId,
        optout_at: null,
      },
      { onConflict: "group_id,line_user_id" }
    );

  await reply(
    "歡迎回來！我會重新開始解析你的訊息來協助旅程規劃。"
  );
}

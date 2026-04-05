import { createAdminClient } from "@/lib/db";
import type { CommandContext } from "../router";

export async function handleOptout(
  ctx: CommandContext,
  reply: (text: string) => Promise<void>
): Promise<void> {
  if (!ctx.dbGroupId || !ctx.userId) {
    await reply("I couldn't identify you. Please try again.");
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
    "Done. I'll no longer process your messages for trip planning.\n" +
      "Type /optin at any time to re-enable."
  );
}

export async function handleOptin(
  ctx: CommandContext,
  reply: (text: string) => Promise<void>
): Promise<void> {
  if (!ctx.dbGroupId || !ctx.userId) {
    await reply("I couldn't identify you. Please try again.");
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
    "Welcome back! I'll start processing your messages again to help with trip planning."
  );
}

import { createAdminClient } from "@/lib/db";
import { track } from "@/lib/analytics";
import { logger } from "@/lib/logger";
import type { CommandContext } from "../router";

export async function handleCancel(
  ctx: CommandContext,
  reply: (text: string) => Promise<void>
): Promise<void> {
  if (!ctx.dbGroupId || !ctx.userId) {
    await reply("無法辨識你的群組，請再試一次。");
    return;
  }

  const db = createAdminClient();

  const { data: membership } = await db
    .from("group_members")
    .select("role")
    .eq("group_id", ctx.dbGroupId)
    .eq("line_user_id", ctx.userId)
    .is("left_at", null)
    .single();

  if (!membership || membership.role !== "organizer") {
    await reply("只有旅程主辦人可以取消旅程。");
    return;
  }

  const { data: trip } = await db
    .from("trips")
    .select("id, destination_name")
    .eq("group_id", ctx.dbGroupId)
    .in("status", ["draft", "active"])
    .single();

  if (!trip) {
    await reply("目前沒有可取消的進行中旅程。");
    return;
  }

  const { error } = await db
    .from("trips")
    .update({ status: "cancelled", ended_at: new Date().toISOString() })
    .eq("id", trip.id);

  if (error) {
    logger.error("cancel trip failed", { groupId: ctx.dbGroupId ?? undefined, userId: ctx.userId });
    await reply("取消旅程時發生問題，請再試一次。");
    return;
  }

  await track("trip_cancelled", {
    groupId: ctx.dbGroupId,
    userId: ctx.userId,
    properties: { destination: trip.destination_name ?? null },
  });

  const label = trip.destination_name ? `前往「${trip.destination_name}」的旅程` : "這趟旅程";
  await reply(
    `${label}已取消。\n\n` +
      `當你準備好時，使用 /start 規劃新的旅程。`
  );
}

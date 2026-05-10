import { createAdminClient } from "@/lib/db";
import { track } from "@/lib/analytics";
import { enrichTripDestinationMetadata } from "@/services/trips/destination";
import { BOT_COPY } from "@/lib/bot-copy";
import type { CommandContext } from "../router";

/**
 * Parse a date range string like "7/15-7/20" into ISO dates.
 * Assumes the current or next calendar year.
 */
function parseDateRange(
  raw: string
): { startDate: string; endDate: string } | null {
  const rangeMatch = raw.match(/^(\d{1,2})\/(\d{1,2})-(\d{1,2})\/(\d{1,2})$/);
  if (rangeMatch) {
    const [, sm, sd, em, ed] = rangeMatch;
    const year = new Date().getFullYear();
    const start = new Date(year, parseInt(sm) - 1, parseInt(sd));
    const end = new Date(year, parseInt(em) - 1, parseInt(ed));
    if (start < new Date()) {
      start.setFullYear(year + 1);
      end.setFullYear(year + 1);
    }
    return {
      startDate: start.toISOString().split("T")[0],
      endDate: end.toISOString().split("T")[0],
    };
  }
  return null;
}

function parseStartArgs(args: string[]): {
  destination: string | null;
  startDate: string | null;
  endDate: string | null;
} {
  if (args.length === 0) {
    return { destination: null, startDate: null, endDate: null };
  }

  const lastArg = args[args.length - 1];
  if (args.length > 1 && lastArg.includes("/")) {
    const parsed = parseDateRange(lastArg);
    if (parsed) {
      return {
        destination: args.slice(0, -1).join(" "),
        startDate: parsed.startDate,
        endDate: parsed.endDate,
      };
    }
  }

  return { destination: args.join(" "), startDate: null, endDate: null };
}

export async function handleStart(
  args: string[],
  ctx: CommandContext,
  reply: (text: string) => Promise<void>
): Promise<void> {
  if (!ctx.dbGroupId || !ctx.userId) {
    await reply("我無法在這裡建立旅程，請在 LINE 群組中再試一次。");
    return;
  }

  const db = createAdminClient();

  const { data: existing } = await db
    .from("trips")
    .select("id, destination_name, status")
    .eq("group_id", ctx.dbGroupId)
    .in("status", ["draft", "active"])
    .single();

  if (existing) {
    const label = existing.destination_name
      ? `：${existing.destination_name}`
      : "正在規劃中";
    await reply(
      `目前已經有一個旅程${label}。\n` +
        `使用 /status 查看，或先用 /cancel 取消現有旅程。`
    );
    return;
  }

  const { destination, startDate, endDate } = parseStartArgs(args);

  const { data: trip, error } = await db
    .from("trips")
    .insert({
      group_id: ctx.dbGroupId,
      destination_name: destination,
      start_date: startDate,
      end_date: endDate,
      status: "active",
      created_by_user_id: ctx.userId,
    })
    .select("id")
    .single();

  if (error || !trip) {
    console.error("[start] failed to create trip", error);
    await reply(BOT_COPY.genericError);
    return;
  }

  await db.from("group_members").upsert(
    {
      group_id: ctx.dbGroupId,
      line_user_id: ctx.userId,
      role: "organizer",
    },
    { onConflict: "group_id,line_user_id" }
  );

  await track("trip_created", {
    groupId: ctx.dbGroupId,
    userId: ctx.userId,
    properties: {
      destination,
      start_date: startDate,
      end_date: endDate,
    },
  });

  if (destination) {
    await enrichTripDestinationMetadata(trip.id, destination);
  }

  if (!destination && !startDate && !endDate) {
    await reply(
      `旅程已建立！\n\n` +
        `目的地、日期和成員還沒決定也沒關係，我們可以一起慢慢整理。\n\n` +
        `可以試試：\n` +
        `- /idea destination Kyoto：先記下一個目的地靈感\n` +
        `- /decide destination：讓大家投票決定\n` +
        `- /add Pick travel dates：新增日期規劃待辦\n\n` +
        `隨時輸入 /status 查看旅程看板。`
    );
    return;
  }

  const destinationLine = destination
    ? `\n目的地：${destination}`
    : `\n目的地：尚未設定（可用 /idea 或 /decide 規劃）`;
  const dateLine =
    startDate && endDate
      ? `\n日期：${startDate} 到 ${endDate}`
      : `\n日期：尚未設定（可在聊天中提到，或用 /add 新增規劃）`;

  await reply(
    `旅程已建立！` +
      destinationLine +
      dateLine +
      `\n\n我會開始整理旅遊相關訊息。` +
      `可用 /add 新增規劃事項、/recommend 回想已保存的資訊，或用 /decide 建立群組投票。\n\n` +
      `輸入 /status 查看旅程看板。`
  );
}

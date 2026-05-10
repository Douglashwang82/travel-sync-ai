import { z } from "zod";
import { createAdminClient } from "@/lib/db";
import { pushText } from "@/lib/line";
import { extractUrlMetadata } from "@/services/share/extractor";
import { rememberPlace } from "@/services/memory";
import type { CommandContext } from "../router";

const URL_RE = /^https?:\/\/.+/i;

const ArgsSchema = z.array(z.string()).min(1);

export async function handleShare(
  args: string[],
  ctx: CommandContext,
  reply: (text: string) => Promise<void>
): Promise<void> {
  if (!ArgsSchema.safeParse(args).success || !ctx.dbGroupId) {
    await reply("用法：/share [網址]\n範例：/share https://booking.com/hotel/xyz");
    return;
  }

  const url = args.find((a) => URL_RE.test(a));
  if (!url) {
    await reply("請提供以 http:// 或 https:// 開頭的有效網址。");
    return;
  }

  const db = createAdminClient();

  const { data: trip } = await db
    .from("trips")
    .select("id, destination_name")
    .eq("group_id", ctx.dbGroupId)
    .in("status", ["draft", "active"])
    .single();

  if (!trip) {
    await reply("目前沒有進行中的旅程。請先使用 /start 建立旅程。");
    return;
  }

  // Acknowledge immediately — fetching may take a few seconds
  await reply("正在抓取這個連結⋯⋯馬上幫你整理細節！");

  let metadata;
  try {
    metadata = await extractUrlMetadata(url);
  } catch (err) {
    console.error("[share] extraction failed", err);
    await pushText(
        ctx.lineGroupId,
        "我無法讀取這個網址，可能需要登入，或被網站封鎖了。\n" +
        "可以改用 /add [項目名稱] 新增規劃項目，或分享其他連結。"
    );
    return;
  }

  const remembered = await rememberPlace({
    tripId: trip.id,
    groupId: ctx.dbGroupId,
    itemType: metadata.item_type,
    title: metadata.name,
    summary: metadata.description,
    address: metadata.address,
    rating: metadata.rating,
    priceLevel: metadata.price,
    imageUrl: metadata.image_url,
    bookingUrl: metadata.booking_url,
    sourceLineUserId: ctx.userId,
  });

  if (!remembered) {
    console.error("[share] failed to remember shared item", metadata);
    await pushText(ctx.lineGroupId, "儲存這個項目時發生問題，請再試一次。");
    return;
  }

  await pushText(ctx.lineGroupId, buildConfirmMessage(metadata));
}

function buildConfirmMessage(m: Awaited<ReturnType<typeof extractUrlMetadata>>): string {
  const lines: string[] = [];

  const typeEmoji: Record<string, string> = {
    hotel: "🏨",
    restaurant: "🍽️",
    activity: "🎯",
    transport: "🚌",
    flight: "✈️",
    insurance: "🛡️",
    other: "📌",
  };

  const emoji = typeEmoji[m.item_type] ?? "📌";
  lines.push(`${emoji} 已存入旅程資料庫：「${m.name}」`);

  if (m.description) lines.push(`\n${m.description}`);

  const meta: string[] = [];
  if (m.rating) meta.push(`⭐ ${m.rating}`);
  if (m.price) meta.push(m.price);
  if (meta.length) lines.push(meta.join("  ·  "));

  if (m.address) lines.push(`📍 ${m.address}`);

  lines.push(`\n稍後可以用 /recommend ${m.item_type} 回顧；當群組準備好選擇時用 /decide ${m.item_type}。`);

  return lines.join("\n");
}

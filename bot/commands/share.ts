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
    await reply("Usage: /share [url]\nExample: /share https://booking.com/hotel/xyz");
    return;
  }

  const url = args.find((a) => URL_RE.test(a));
  if (!url) {
    await reply("Please provide a valid URL starting with http:// or https://");
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
    await reply("No active trip. Use /start to create one first.");
    return;
  }

  // Acknowledge immediately — fetching may take a few seconds
  await reply("Fetching that link... I'll extract the details in a moment!");

  let metadata;
  try {
    metadata = await extractUrlMetadata(url);
  } catch (err) {
    console.error("[share] extraction failed", err);
    await pushText(
      ctx.lineGroupId,
      "I couldn't read that URL. It may be behind a login or the site blocked me.\n" +
        "Try /add [item name] to manually add it to the board."
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
    await pushText(ctx.lineGroupId, "Something went wrong saving that item. Please try again.");
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
  lines.push(`${emoji} Added to To-Do: "${m.name}"`);

  if (m.description) lines.push(`\n${m.description}`);

  const meta: string[] = [];
  if (m.rating) meta.push(`⭐ ${m.rating}`);
  if (m.price) meta.push(m.price);
  if (meta.length) lines.push(meta.join("  ·  "));

  if (m.address) lines.push(`📍 ${m.address}`);

  lines.push(`\nUse /vote ${m.item_type} to start a group vote.`);

  return lines.join("\n");
}

import { z } from "zod";
import { createAdminClient } from "@/lib/db";
import { extractUrlMetadata } from "@/services/share/extractor";
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

  const url = args[0];
  if (!URL_RE.test(url)) {
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
    await reply(
      "I couldn't read that URL. It may be behind a login or the site blocked me.\n" +
        "Try /add [item name] to manually add it to the board."
    );
    return;
  }

  // Create the trip item
  const { data: item, error: itemError } = await db
    .from("trip_items")
    .insert({
      trip_id: trip.id,
      title: metadata.name,
      description: metadata.description,
      item_type: metadata.item_type,
      stage: "todo",
      source: "command",
    })
    .select("id")
    .single();

  if (itemError || !item) {
    console.error("[share] failed to insert trip_item", itemError);
    await reply("Something went wrong saving that item. Please try again.");
    return;
  }

  // Create the option (the shared URL becomes a voteable candidate)
  const { error: optionError } = await db.from("trip_item_options").insert({
    trip_item_id: item.id,
    provider: "manual",
    name: metadata.name,
    image_url: metadata.image_url,
    rating: metadata.rating,
    price_level: metadata.price,
    address: metadata.address,
    booking_url: metadata.booking_url,
    metadata_json: {
      description: metadata.description,
      shared_by: ctx.userId ?? "unknown",
    },
  });

  if (optionError) {
    // Non-fatal: item was saved; just log
    console.error("[share] failed to insert trip_item_option", optionError);
  }

  await reply(buildConfirmMessage(metadata));
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

import { createAdminClient } from "@/lib/db";
import { track } from "@/lib/analytics";
import type { CommandContext } from "../router";

const CATEGORIES = new Set(["destination", "hotel", "activity", "restaurant", "general"]);

/**
 * /idea [text]
 * /idea [category] [text]
 *
 * Drop a brainstorm idea onto the trip idea board.
 * Examples:
 *   /idea Let's try a ryokan in Kyoto
 *   /idea destination What about Sapporo instead?
 *   /idea restaurant Any ramen place near Shinjuku
 *
 * The organizer can later promote an idea to a decision item with /decide.
 */
export async function handleIdea(
  args: string[],
  ctx: CommandContext,
  reply: (text: string) => Promise<void>
): Promise<void> {
  if (!ctx.dbGroupId || !ctx.userId) {
    await reply("This command must be used inside a group chat.");
    return;
  }

  if (args.length === 0) {
    await reply(
      "Usage: /idea [category] [text]\n" +
        "Categories: destination, hotel, activity, restaurant, general (default)\n\n" +
        "Examples:\n  /idea Let's visit Sapporo\n  /idea restaurant Any ramen near Shinjuku"
    );
    return;
  }

  const db = createAdminClient();

  // Check for an active trip
  const { data: trip } = await db
    .from("trips")
    .select("id, destination_name")
    .eq("group_id", ctx.dbGroupId)
    .in("status", ["draft", "active"])
    .single();

  if (!trip) {
    await reply("No active trip found. Start one first with /start [destination] [dates].");
    return;
  }

  // Check opt-out
  const { data: member } = await db
    .from("group_members")
    .select("display_name, opted_out")
    .eq("group_id", ctx.dbGroupId)
    .eq("line_user_id", ctx.userId)
    .is("left_at", null)
    .single();

  if (member?.opted_out) {
    await reply("You've opted out of TravelSync. Type /optin to re-enable it.");
    return;
  }

  // Parse optional category prefix
  let category = "general";
  let textParts = args;
  if (args.length > 1 && CATEGORIES.has(args[0].toLowerCase())) {
    category = args[0].toLowerCase();
    textParts = args.slice(1);
  }

  const text = textParts.join(" ").trim();
  if (!text) {
    await reply("Please include some idea text. Example: /idea Let's check out Arashiyama");
    return;
  }

  if (text.length > 500) {
    await reply("Idea is too long (max 500 characters). Please shorten it.");
    return;
  }

  const { error } = await db.from("trip_ideas").insert({
    trip_id: trip.id,
    group_id: ctx.dbGroupId,
    submitted_by: ctx.userId,
    display_name: member?.display_name ?? null,
    category,
    text,
  });

  if (error) {
    await reply("Failed to save your idea. Please try again.");
    return;
  }

  await track("idea_submitted", {
    groupId: ctx.dbGroupId,
    userId: ctx.userId,
    properties: { trip_id: trip.id, category },
  });

  const categoryLabel = category !== "general" ? ` [${category}]` : "";
  const displayName = member?.display_name ?? "Someone";

  await reply(
    `💡 Idea noted${categoryLabel}: "${text}"\n` +
      `— ${displayName}\n\n` +
      `The organizer can promote it to a vote with /decide [item] when the group is ready.`
  );
}

/**
 * /ideas
 *
 * List all un-promoted ideas for the active trip, grouped by category.
 */
export async function handleIdeas(
  ctx: CommandContext,
  reply: (text: string) => Promise<void>
): Promise<void> {
  if (!ctx.dbGroupId) {
    await reply("This command must be used inside a group chat.");
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
    await reply("No active trip to show ideas for.");
    return;
  }

  const { data: ideas } = await db
    .from("trip_ideas")
    .select("id, category, text, display_name, created_at")
    .eq("trip_id", trip.id)
    .eq("promoted", false)
    .order("created_at", { ascending: true })
    .limit(30);

  if (!ideas?.length) {
    await reply(
      `No brainstorm ideas yet for ${trip.destination_name}.\n\nDrop one with /idea [text].`
    );
    return;
  }

  // Group by category
  const byCategory = new Map<string, string[]>();
  for (const idea of ideas) {
    const cat = idea.category as string;
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    const who = idea.display_name ? ` (${idea.display_name})` : "";
    byCategory.get(cat)!.push(`  • ${idea.text}${who}`);
  }

  const sections: string[] = [`💡 Brainstorm — ${trip.destination_name} (${ideas.length} idea${ideas.length === 1 ? "" : "s"})`];
  for (const [cat, lines] of byCategory) {
    sections.push(`\n${cat.charAt(0).toUpperCase() + cat.slice(1)}\n${lines.join("\n")}`);
  }
  sections.push(`\nUse /decide [item] to turn an idea into a vote.`);

  await reply(sections.join(""));
}

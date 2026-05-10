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
    await reply("這個指令只能在群組聊天中使用。");
    return;
  }

  if (args.length === 0) {
    await reply(
      "用法：/idea [分類] [內容]\n" +
        "分類：destination、hotel、activity、restaurant、general（預設）\n\n" +
        "範例：\n  /idea 想去札幌看看\n  /idea restaurant 新宿附近有什麼好吃的拉麵"
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
    await reply("目前沒有進行中的旅程。請先使用 /start [目的地] [日期] 建立旅程。");
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
    await reply("你已停用 TravelSync。輸入 /optin 可以重新啟用。");
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
    await reply("請加上一點靈感內容。範例：/idea 來去嵐山逛逛");
    return;
  }

  if (text.length > 500) {
    await reply("靈感內容太長了（上限 500 字），請縮短一點。");
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
    await reply("儲存靈感失敗，請再試一次。");
    return;
  }

  await track("idea_submitted", {
    groupId: ctx.dbGroupId,
    userId: ctx.userId,
    properties: { trip_id: trip.id, category },
  });

  const categoryLabel = category !== "general" ? ` [${category}]` : "";
  const displayName = member?.display_name ?? "某位成員";

  await reply(
    `💡 已記下靈感${categoryLabel}：「${text}」\n` +
      `— ${displayName}\n\n` +
      `當群組準備好時，主辦人可以用 /decide [項目] 把它升級成投票。`
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
    await reply("這個指令只能在群組聊天中使用。");
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
    await reply("目前沒有可查看靈感的進行中旅程。");
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
      `${trip.destination_name ?? "這趟旅程"}還沒有任何靈感。\n\n用 /idea [內容] 隨手記下一個吧。`
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

  const sections: string[] = [`💡 靈感 — ${trip.destination_name ?? "這趟旅程"}（共 ${ideas.length} 則）`];
  for (const [cat, lines] of byCategory) {
    sections.push(`\n${cat.charAt(0).toUpperCase() + cat.slice(1)}\n${lines.join("\n")}`);
  }
  sections.push(`\n使用 /decide [項目] 可以把靈感變成投票。`);

  await reply(sections.join(""));
}

import { createAdminClient } from "@/lib/db";
import { track } from "@/lib/analytics";
import type { CommandContext } from "../router";

type PackCategory = "documents" | "clothing" | "toiletries" | "electronics" | "safety" | "general";

const CATEGORY_ALIASES: Record<string, PackCategory> = {
  documents: "documents", docs: "documents", doc: "documents", 文件: "documents",
  clothing: "clothing", clothes: "clothing", 衣物: "clothing",
  toiletries: "toiletries", toiletry: "toiletries", 盥洗: "toiletries",
  electronics: "electronics", tech: "electronics", 電子: "electronics",
  safety: "safety", 安全: "safety",
  general: "general", misc: "general", other: "general", 其他: "general",
};

const CATEGORY_ICONS: Record<PackCategory, string> = {
  documents: "📄",
  clothing: "👕",
  toiletries: "🧴",
  electronics: "🔌",
  safety: "🛡️",
  general: "📦",
};

/**
 * /pack add [category?] [item]
 * /pack list
 * /pack check [item number]
 * /pack help
 */
export async function handlePack(
  args: string[],
  ctx: CommandContext,
  reply: (text: string) => Promise<void>
): Promise<void> {
  if (!ctx.dbGroupId || !ctx.userId) {
    await reply("This command must be used inside a group chat.");
    return;
  }

  const sub = args[0]?.toLowerCase();

  if (!sub || sub === "help") {
    await reply(
      "Packing list commands:\n\n" +
        "/pack add [category?] [item] — add an item\n" +
        "/pack list — show all items with check status\n" +
        "/pack check [#] — mark item as packed\n\n" +
        "Categories: documents, clothing, toiletries, electronics, safety, general\n\n" +
        "Examples:\n" +
        "  /pack add passport\n" +
        "  /pack add clothing t-shirt x5\n" +
        "  /pack list\n" +
        "  /pack check 3"
    );
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
    await reply("No active trip found. Use /start to create one first.");
    return;
  }

  const { data: group } = await db
    .from("line_groups")
    .select("id")
    .eq("id", ctx.dbGroupId)
    .single();

  if (!group) {
    await reply("Group not found.");
    return;
  }

  if (sub === "add") {
    const remaining = args.slice(1);
    if (!remaining.length) {
      await reply("Usage: /pack add [category?] [item]\nExample: /pack add clothing rain jacket");
      return;
    }

    const rawCat = remaining[0].toLowerCase();
    let category: PackCategory = "general";
    let labelParts = remaining;

    if (rawCat in CATEGORY_ALIASES) {
      category = CATEGORY_ALIASES[rawCat];
      labelParts = remaining.slice(1);
    }

    const label = labelParts.join(" ").trim();
    if (!label) {
      await reply("Please provide an item name. Example: /pack add clothing rain jacket");
      return;
    }

    const { error } = await db.from("packing_items").insert({
      trip_id: trip.id,
      group_id: ctx.dbGroupId,
      label,
      category,
      is_shared: true,
      added_by: ctx.userId,
    });

    if (error) {
      await reply("Failed to add item. Please try again.");
      return;
    }

    await track("idea_submitted", {
      groupId: ctx.dbGroupId,
      userId: ctx.userId,
      properties: { type: "pack_item", category, trip_id: trip.id },
    });

    await reply(
      `${CATEGORY_ICONS[category]} Added to packing list: ${label} [${category}]\n\nUse /pack list to see everything.`
    );
    return;
  }

  if (sub === "list") {
    return handlePackList(ctx.dbGroupId, ctx.userId, trip.id, trip.destination_name ?? "your trip", reply);
  }

  if (sub === "check") {
    const numStr = args[1];
    if (!numStr || !/^\d+$/.test(numStr)) {
      await reply("Usage: /pack check [#]\nExample: /pack check 3");
      return;
    }

    const itemNum = parseInt(numStr, 10);
    const { data: items } = await db
      .from("packing_items")
      .select("id, label, category")
      .eq("trip_id", trip.id)
      .order("created_at", { ascending: true });

    if (!items?.length) {
      await reply("No items in packing list yet. Use /pack add [item] to add some.");
      return;
    }

    if (itemNum < 1 || itemNum > items.length) {
      await reply(`Item #${itemNum} not found. Use /pack list to see item numbers.`);
      return;
    }

    const item = items[itemNum - 1];

    const { error } = await db.from("packing_checks").upsert(
      { item_id: item.id, line_user_id: ctx.userId },
      { onConflict: "item_id,line_user_id", ignoreDuplicates: true }
    );

    if (error) {
      await reply("Failed to mark item. Please try again.");
      return;
    }

    const cat = item.category as PackCategory;
    await reply(`${CATEGORY_ICONS[cat] ?? "📦"} Checked off: ${item.label}`);
    return;
  }

  await reply("Unknown sub-command. Use /pack help to see options.");
}

async function handlePackList(
  groupId: string,
  userId: string,
  tripId: string,
  destination: string,
  reply: (text: string) => Promise<void>
): Promise<void> {
  const db = createAdminClient();

  const { data: items } = await db
    .from("packing_items")
    .select("id, label, category")
    .eq("trip_id", tripId)
    .order("category", { ascending: true })
    .order("created_at", { ascending: true });

  if (!items?.length) {
    await reply(
      `No packing items yet for ${destination}.\n\n` +
        "Add items with: /pack add [category?] [item]"
    );
    return;
  }

  const { data: myChecks } = await db
    .from("packing_checks")
    .select("item_id")
    .eq("line_user_id", userId)
    .in(
      "item_id",
      items.map((i) => i.id)
    );

  const checkedIds = new Set((myChecks ?? []).map((c) => c.item_id));

  const { data: allChecks } = await db
    .from("packing_checks")
    .select("item_id")
    .in(
      "item_id",
      items.map((i) => i.id)
    );

  const checkCounts = new Map<string, number>();
  for (const c of allChecks ?? []) {
    checkCounts.set(c.item_id, (checkCounts.get(c.item_id) ?? 0) + 1);
  }

  const byCategory = new Map<string, Array<{ num: number; label: string; id: string }>>();
  items.forEach((item, idx) => {
    const cat = item.category ?? "general";
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push({ num: idx + 1, label: item.label, id: item.id });
  });

  const lines: string[] = [`Packing List — ${destination}`];
  let totalChecked = 0;

  for (const [cat, catItems] of byCategory) {
    const catKey = cat as PackCategory;
    lines.push(`\n${CATEGORY_ICONS[catKey] ?? "📦"} ${cat}`);
    for (const item of catItems) {
      const myCheck = checkedIds.has(item.id) ? "✓" : "○";
      const others = checkCounts.get(item.id) ?? 0;
      const othersText = others > 0 ? ` (${others} packed)` : "";
      lines.push(`  ${myCheck} #${item.num} ${item.label}${othersText}`);
      if (checkedIds.has(item.id)) totalChecked++;
    }
  }

  const pct = Math.round((totalChecked / items.length) * 100);
  lines.push(`\nYour progress: ${totalChecked}/${items.length} items (${pct}%)`);
  lines.push("Use /pack check [#] to mark items as packed.");

  await reply(lines.join("\n"));
}

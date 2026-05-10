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
    await reply("這個指令只能在群組聊天中使用。");
    return;
  }

  const sub = args[0]?.toLowerCase();

  if (!sub || sub === "help") {
    await reply(
      "打包清單指令：\n\n" +
        "/pack add [分類?] [物品] — 新增物品\n" +
        "/pack list — 顯示所有物品與打包狀態\n" +
        "/pack check [編號] — 標記物品為已打包\n\n" +
        "分類：documents、clothing、toiletries、electronics、safety、general\n\n" +
        "範例：\n" +
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
    await reply("目前沒有進行中的旅程。請先使用 /start 建立旅程。");
    return;
  }

  const { data: group } = await db
    .from("line_groups")
    .select("id")
    .eq("id", ctx.dbGroupId)
    .single();

  if (!group) {
    await reply("找不到這個群組。");
    return;
  }

  if (sub === "add") {
    const remaining = args.slice(1);
    if (!remaining.length) {
      await reply("用法：/pack add [分類?] [物品]\n範例：/pack add clothing 雨衣");
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
      await reply("請提供物品名稱。範例：/pack add clothing 雨衣");
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
      await reply("新增物品失敗，請再試一次。");
      return;
    }

    await track("idea_submitted", {
      groupId: ctx.dbGroupId,
      userId: ctx.userId,
      properties: { type: "pack_item", category, trip_id: trip.id },
    });

    await reply(
      `${CATEGORY_ICONS[category]} 已加入打包清單：${label} [${category}]\n\n使用 /pack list 查看所有項目。`
    );
    return;
  }

  if (sub === "list") {
    return handlePackList(ctx.dbGroupId, ctx.userId, trip.id, trip.destination_name ?? "這趟旅程", reply);
  }

  if (sub === "check") {
    const numStr = args[1];
    if (!numStr || !/^\d+$/.test(numStr)) {
      await reply("用法：/pack check [編號]\n範例：/pack check 3");
      return;
    }

    const itemNum = parseInt(numStr, 10);
    const { data: items } = await db
      .from("packing_items")
      .select("id, label, category")
      .eq("trip_id", trip.id)
      .order("created_at", { ascending: true });

    if (!items?.length) {
      await reply("打包清單還沒有任何項目。使用 /pack add [物品] 來新增。");
      return;
    }

    if (itemNum < 1 || itemNum > items.length) {
      await reply(`找不到編號 #${itemNum} 的項目。使用 /pack list 查看項目編號。`);
      return;
    }

    const item = items[itemNum - 1];

    const { error } = await db.from("packing_checks").upsert(
      { item_id: item.id, line_user_id: ctx.userId },
      { onConflict: "item_id,line_user_id", ignoreDuplicates: true }
    );

    if (error) {
      await reply("標記物品失敗，請再試一次。");
      return;
    }

    const cat = item.category as PackCategory;
    await reply(`${CATEGORY_ICONS[cat] ?? "📦"} 已打包：${item.label}`);
    return;
  }

  await reply("未知的子指令。使用 /pack help 查看可用選項。");
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
      `${destination}的打包清單還是空的。\n\n` +
        "新增物品：/pack add [分類?] [物品]"
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

  const lines: string[] = [`打包清單 — ${destination}`];
  let totalChecked = 0;

  for (const [cat, catItems] of byCategory) {
    const catKey = cat as PackCategory;
    lines.push(`\n${CATEGORY_ICONS[catKey] ?? "📦"} ${cat}`);
    for (const item of catItems) {
      const myCheck = checkedIds.has(item.id) ? "✓" : "○";
      const others = checkCounts.get(item.id) ?? 0;
      const othersText = others > 0 ? `（已有 ${others} 人打包）` : "";
      lines.push(`  ${myCheck} #${item.num} ${item.label}${othersText}`);
      if (checkedIds.has(item.id)) totalChecked++;
    }
  }

  const pct = Math.round((totalChecked / items.length) * 100);
  lines.push(`\n你的進度：${totalChecked}/${items.length} 項（${pct}%）`);
  lines.push("使用 /pack check [編號] 標記為已打包。");

  await reply(lines.join("\n"));
}

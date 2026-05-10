import { createAdminClient } from "@/lib/db";
import { track } from "@/lib/analytics";
import type { CommandContext } from "../router";

type DocType = "passport" | "visa" | "insurance" | "other";

const DOC_TYPE_ALIASES: Record<string, DocType> = {
  passport: "passport", pass: "passport", 護照: "passport",
  visa: "visa", "e-visa": "visa", evisa: "visa", 簽證: "visa",
  insurance: "insurance", insur: "insurance", ins: "insurance", 保險: "insurance",
  other: "other", doc: "other", 文件: "other",
};

/**
 * /docs add [type] [label?] [expires YYYY-MM-DD?]
 * /docs list
 * /docs help
 *
 * Examples:
 *   /docs add passport expires 2028-03-15
 *   /docs add visa Japan e-Visa expires 2026-09-01
 *   /docs add insurance AXA travel policy
 *   /docs list
 */
export async function handleDocs(
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
      "旅遊文件指令：\n\n" +
        "/docs add [類型] [標籤] — 新增你的文件\n" +
        "/docs list — 顯示群組所有文件\n\n" +
        "類型：passport、visa、insurance、other\n\n" +
        "範例：\n" +
        "  /docs add passport expires 2028-03-15\n" +
        "  /docs add visa 日本 e-Visa expires 2026-09-01\n" +
        "  /docs add insurance AXA 旅平險"
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

  const { data: member } = await db
    .from("group_members")
    .select("display_name")
    .eq("group_id", ctx.dbGroupId)
    .eq("line_user_id", ctx.userId)
    .is("left_at", null)
    .single();

  const displayName = member?.display_name ?? "未知成員";

  if (sub === "list") {
    return handleDocsList(ctx.dbGroupId, trip.destination_name ?? "這趟旅程", reply);
  }

  if (sub === "add") {
    const remaining = args.slice(1);
    if (!remaining.length) {
      await reply("用法：/docs add [類型] [標籤?] [expires YYYY-MM-DD?]\n範例：/docs add passport expires 2028-03-15");
      return;
    }

    // Parse doc type
    const rawType = remaining[0].toLowerCase();
    const docType: DocType = DOC_TYPE_ALIASES[rawType] ?? "other";
    const afterType = rawType in DOC_TYPE_ALIASES ? remaining.slice(1) : remaining;

    // Parse expires date if present
    let expiresAt: string | null = null;
    const expiresIdx = afterType.findIndex((t) => t.toLowerCase() === "expires");
    let labelParts = afterType;
    if (expiresIdx !== -1 && afterType[expiresIdx + 1]) {
      const dateStr = afterType[expiresIdx + 1];
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        expiresAt = dateStr;
        labelParts = afterType.filter((_, i) => i !== expiresIdx && i !== expiresIdx + 1);
      }
    }

    const docLabel = labelParts.join(" ").trim() || null;

    // Determine status based on expiry
    let status = "ok";
    if (expiresAt) {
      const daysUntilExpiry = Math.floor(
        (new Date(expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
      );
      if (daysUntilExpiry < 0) status = "expired";
      else if (daysUntilExpiry < 180) status = "expiring";
    }

    const { error } = await db.from("travel_documents").insert({
      trip_id: trip.id,
      group_id: ctx.dbGroupId,
      line_user_id: ctx.userId,
      display_name: displayName,
      doc_type: docType,
      doc_label: docLabel,
      expires_at: expiresAt,
      status,
    });

    if (error) {
      await reply("儲存文件失敗，請再試一次。");
      return;
    }

    await track("budget_set", {
      groupId: ctx.dbGroupId,
      userId: ctx.userId,
      properties: { doc_type: docType, trip_id: trip.id },
    });

    const labelText = docLabel ? `（${docLabel}）` : "";
    const expiryText = expiresAt ? ` · 到期日 ${expiresAt}` : "";
    const warningText = status === "expired"
      ? "\n⚠️ 這份文件似乎已過期！"
      : status === "expiring"
        ? "\n⚠️ 這份文件將在 6 個月內到期，出發前請再確認。"
        : "";

    await reply(
      `已為 ${displayName} 儲存文件：\n${docType}${labelText}${expiryText}${warningText}\n\n使用 /docs list 查看群組所有文件。`
    );
    return;
  }

  await reply("未知的子指令。使用 /docs help 查看可用選項。");
}

async function handleDocsList(
  groupId: string,
  destination: string,
  reply: (text: string) => Promise<void>
): Promise<void> {
  const db = createAdminClient();

  const { data: trip } = await db
    .from("trips")
    .select("id")
    .eq("group_id", groupId)
    .in("status", ["draft", "active"])
    .single();

  if (!trip) {
    await reply("目前沒有進行中的旅程。");
    return;
  }

  const { data: docs } = await db
    .from("travel_documents")
    .select("doc_type, doc_label, display_name, expires_at, status")
    .eq("trip_id", trip.id)
    .order("display_name", { ascending: true });

  if (!docs?.length) {
    await reply(
      `${destination}還沒有記錄任何旅遊文件。\n\n` +
        "新增方式：/docs add [類型] [標籤?] [expires YYYY-MM-DD?]"
    );
    return;
  }

  const statusIcon: Record<string, string> = { ok: "✅", expiring: "⚠️", expired: "❌", missing: "❓" };
  const lines: string[] = [`旅遊文件 — ${destination}`];

  const byPerson = new Map<string, string[]>();
  for (const doc of docs) {
    const name = doc.display_name ?? "未知成員";
    if (!byPerson.has(name)) byPerson.set(name, []);
    const icon = statusIcon[doc.status as string] ?? "📄";
    const label = doc.doc_label ? `（${doc.doc_label}）` : "";
    const expiry = doc.expires_at ? ` 到期日 ${doc.expires_at}` : "";
    byPerson.get(name)!.push(`  ${icon} ${doc.doc_type}${label}${expiry}`);
  }

  for (const [name, entries] of byPerson) {
    lines.push(`\n${name}：`);
    lines.push(...entries);
  }

  const warnings = docs.filter((d) => d.status === "expiring" || d.status === "expired");
  if (warnings.length > 0) {
    lines.push(`\n⚠️ 有 ${warnings.length} 份文件需要在出發前處理。`);
  }

  await reply(lines.join("\n"));
}

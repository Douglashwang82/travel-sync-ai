import { createAdminClient } from "@/lib/db";
import { track } from "@/lib/analytics";
import type { CommandContext } from "../router";

const DOC_TYPES = ["passport", "visa", "insurance", "other"] as const;
type DocType = (typeof DOC_TYPES)[number];

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
    await reply("This command must be used inside a group chat.");
    return;
  }

  const sub = args[0]?.toLowerCase();

  if (!sub || sub === "help") {
    await reply(
      "Travel document commands:\n\n" +
        "/docs add [type] [label] — add your document\n" +
        "/docs list — show all group docs\n\n" +
        "Types: passport, visa, insurance, other\n\n" +
        "Examples:\n" +
        "  /docs add passport expires 2028-03-15\n" +
        "  /docs add visa Japan e-Visa expires 2026-09-01\n" +
        "  /docs add insurance AXA travel policy"
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

  const { data: member } = await db
    .from("group_members")
    .select("display_name")
    .eq("group_id", ctx.dbGroupId)
    .eq("line_user_id", ctx.userId)
    .is("left_at", null)
    .single();

  const displayName = member?.display_name ?? "Unknown";

  if (sub === "list") {
    return handleDocsList(ctx.dbGroupId, trip.destination_name, reply);
  }

  if (sub === "add") {
    const remaining = args.slice(1);
    if (!remaining.length) {
      await reply("Usage: /docs add [type] [label?] [expires YYYY-MM-DD?]\nExample: /docs add passport expires 2028-03-15");
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
      await reply("Failed to save document. Please try again.");
      return;
    }

    await track("budget_set", {
      groupId: ctx.dbGroupId,
      userId: ctx.userId,
      properties: { doc_type: docType, trip_id: trip.id },
    });

    const labelText = docLabel ? ` (${docLabel})` : "";
    const expiryText = expiresAt ? ` · expires ${expiresAt}` : "";
    const warningText = status === "expired"
      ? "\n⚠️ This document appears to be expired!"
      : status === "expiring"
        ? "\n⚠️ This document expires within 6 months — verify before travel."
        : "";

    await reply(
      `Document saved for ${displayName}:\n${docType}${labelText}${expiryText}${warningText}\n\nUse /docs list to see all group documents.`
    );
    return;
  }

  await reply("Unknown sub-command. Use /docs help to see options.");
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
    await reply("No active trip found.");
    return;
  }

  const { data: docs } = await db
    .from("travel_documents")
    .select("doc_type, doc_label, display_name, expires_at, status")
    .eq("trip_id", trip.id)
    .order("display_name", { ascending: true });

  if (!docs?.length) {
    await reply(
      `No travel documents recorded yet for ${destination}.\n\n` +
        "Add yours with: /docs add [type] [label?] [expires YYYY-MM-DD?]"
    );
    return;
  }

  const statusIcon: Record<string, string> = { ok: "✅", expiring: "⚠️", expired: "❌", missing: "❓" };
  const lines: string[] = [`Travel Documents — ${destination}`];

  const byPerson = new Map<string, string[]>();
  for (const doc of docs) {
    const name = doc.display_name ?? "Unknown";
    if (!byPerson.has(name)) byPerson.set(name, []);
    const icon = statusIcon[doc.status as string] ?? "📄";
    const label = doc.doc_label ? ` (${doc.doc_label})` : "";
    const expiry = doc.expires_at ? ` expires ${doc.expires_at}` : "";
    byPerson.get(name)!.push(`  ${icon} ${doc.doc_type}${label}${expiry}`);
  }

  for (const [name, entries] of byPerson) {
    lines.push(`\n${name}:`);
    lines.push(...entries);
  }

  const warnings = docs.filter((d) => d.status === "expiring" || d.status === "expired");
  if (warnings.length > 0) {
    lines.push(`\n⚠️ ${warnings.length} document(s) need attention before travel.`);
  }

  await reply(lines.join("\n"));
}

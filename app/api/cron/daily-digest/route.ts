import { NextRequest, NextResponse } from "next/server";
import { verifyCronRequest } from "@/lib/cron-auth";
import { createAdminClient } from "@/lib/db";
import { pushText } from "@/lib/line";
import { track } from "@/lib/analytics";

const LOOKBACK_HOURS = 24;
// Prevent double-firing if the cron runs slightly off-schedule
const COOLDOWN_HOURS = 20;

/**
 * GET /api/cron/daily-digest
 *
 * Runs daily. For each active trip group, summarises what the AI captured
 * in the last 24 hours:
 *   - Per-user availability windows
 *   - New vote options added from chat
 *   - New checklist items with deadlines
 *
 * Groups with nothing new are skipped silently.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const authError = verifyCronRequest(req);
  if (authError) return authError;

  const db = createAdminClient();
  const since = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();
  const cooldownThreshold = new Date(Date.now() - COOLDOWN_HOURS * 60 * 60 * 1000).toISOString();

  // Fetch all active trips with their LINE group IDs
  const { data: activeTrips } = await db
    .from("trips")
    .select("id, group_id, line_groups!inner(id, line_group_id)")
    .in("status", ["draft", "active"]);

  if (!activeTrips?.length) {
    return NextResponse.json({ digests: 0 });
  }

  let digests = 0;

  for (const trip of activeTrips) {
    const lineGroup = Array.isArray(trip.line_groups) ? trip.line_groups[0] : trip.line_groups;
    if (!lineGroup?.line_group_id) continue;

    const groupId = trip.group_id;
    const tripId = trip.id;

    // Check cooldown — skip if we already sent a digest for this group recently
    const { data: recentDigest } = await db
      .from("analytics_events")
      .select("id")
      .eq("event_name", "daily_digest_sent")
      .eq("group_id", groupId)
      .gte("created_at", cooldownThreshold)
      .limit(1)
      .single();

    if (recentDigest) continue;

    // ── 1. Availability entries ──────────────────────────────────────────────
    const { data: availabilityRows } = await db
      .from("parsed_entities")
      .select("canonical_value, display_value, attributes_json")
      .eq("trip_id", tripId)
      .eq("entity_type", "availability")
      .gte("created_at", since);

    // Resolve display names for user IDs
    const availabilityLines: string[] = [];
    if (availabilityRows?.length) {
      // Collect unique user IDs so we can batch-fetch display names
      const userIds = [
        ...new Set(
          availabilityRows
            .map((r) => (r.attributes_json as Record<string, unknown>)?.line_user_id as string)
            .filter(Boolean)
        ),
      ];

      const { data: members } = userIds.length
        ? await db
            .from("group_members")
            .select("line_user_id, display_name")
            .eq("group_id", groupId)
            .in("line_user_id", userIds)
        : { data: [] };

      const nameMap = new Map(
        (members ?? []).map((m) => [m.line_user_id, m.display_name ?? m.line_user_id])
      );

      for (const row of availabilityRows) {
        const userId = (row.attributes_json as Record<string, unknown>)?.line_user_id as
          | string
          | undefined;
        const name = userId ? (nameMap.get(userId) ?? userId) : "Someone";
        availabilityLines.push(`  • ${name}: ${row.display_value}`);
      }
    }

    // ── 2. New vote options added by AI ──────────────────────────────────────
    const { data: newOptions } = await db
      .from("trip_item_options")
      .select("name, trip_items!inner(title, item_type, trip_id)")
      .eq("trip_items.trip_id", tripId)
      .eq("provider", "manual")
      .gte("created_at", since);

    const optionLines: string[] = [];
    if (newOptions?.length) {
      for (const opt of newOptions) {
        const item = Array.isArray(opt.trip_items) ? opt.trip_items[0] : opt.trip_items;
        if (!item) continue;
        optionLines.push(`  • ${item.item_type}: ${opt.name}`);
      }
    }

    // ── 3. New AI-created checklist items with deadlines ─────────────────────
    const { data: deadlineItems } = await db
      .from("trip_items")
      .select("title, deadline_at")
      .eq("trip_id", tripId)
      .eq("source", "ai")
      .not("deadline_at", "is", null)
      .gte("created_at", since);

    const deadlineLines: string[] = [];
    if (deadlineItems?.length) {
      for (const di of deadlineItems) {
        const deadline = di.deadline_at
          ? new Date(di.deadline_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })
          : null;
        deadlineLines.push(
          deadline ? `  • ${di.title} (deadline: ${deadline})` : `  • ${di.title}`
        );
      }
    }

    // Skip groups with nothing new
    if (!availabilityLines.length && !optionLines.length && !deadlineLines.length) continue;

    // ── Build and send the digest message ────────────────────────────────────
    const sections: string[] = ["🗓 Daily Trip Update"];

    if (availabilityLines.length) {
      sections.push(`\n📅 Availability\n${availabilityLines.join("\n")}`);
    }
    if (optionLines.length) {
      sections.push(`\n🗳 New Options Added\n${optionLines.join("\n")}`);
    }
    if (deadlineLines.length) {
      sections.push(`\n✅ New Checklist Items\n${deadlineLines.join("\n")}`);
    }

    await pushText(lineGroup.line_group_id, sections.join("\n"));

    await track("daily_digest_sent", {
      groupId,
      properties: {
        availability_count: availabilityLines.length,
        options_count: optionLines.length,
        deadline_items_count: deadlineLines.length,
      },
    }).catch(() => {});

    digests++;
  }

  console.info(`[cron/daily-digest] sent ${digests} digests`);
  return NextResponse.json({ digests });
}

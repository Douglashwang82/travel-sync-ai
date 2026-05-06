import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/db";
import { requireAppTripAccess } from "@/lib/app-server";
import { pushText } from "@/lib/line";
import { track } from "@/lib/analytics";

type RouteContext = {
  params: Promise<{ tripId: string; itemId: string }>;
};

const NUDGE_COOLDOWN_MS = 30 * 60 * 1000;

const NudgeSchema = z
  .object({
    lineUserIds: z.array(z.string().min(1)).optional(),
  })
  .default({});

export interface NudgeResponse {
  nudged: Array<{ lineUserId: string; displayName: string | null }>;
  skipped: Array<{
    lineUserId: string;
    displayName: string | null;
    reason: "cooldown" | "already_voted" | "not_a_member";
    nextAllowedAt?: string;
  }>;
}

/**
 * POST /api/app/trips/:tripId/votes/:itemId/nudge
 *
 * Sends a LINE push to every non-voter (or to the explicitly listed users) on
 * a pending vote, prompting them to cast their vote. A 30-minute cooldown is
 * enforced per (item, recipient) using the `nudge_sent` analytics event so the
 * same person can't be spammed across instances.
 *
 * Any group member can nudge. The acting user is recorded in analytics for
 * audit.
 */
export async function POST(
  req: NextRequest,
  ctx: RouteContext
): Promise<NextResponse> {
  const { tripId, itemId } = await ctx.params;
  const auth = await requireAppTripAccess(req, tripId);
  if (!auth.ok) return auth.response;

  let body: unknown = {};
  if (req.headers.get("content-length") !== "0") {
    try {
      body = await req.json();
    } catch {
      // empty body is fine
    }
  }
  const parsed = NudgeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", code: "VALIDATION_ERROR" },
      { status: 400 }
    );
  }
  const requestedIds = parsed.data.lineUserIds;

  const db = createAdminClient();

  const { data: item } = await db
    .from("trip_items")
    .select("id, trip_id, title, stage, deadline_at")
    .eq("id", itemId)
    .single();

  if (!item || item.trip_id !== tripId) {
    return NextResponse.json(
      { error: "Item not found in this trip", code: "NOT_FOUND" },
      { status: 404 }
    );
  }
  if (item.stage !== "pending") {
    return NextResponse.json(
      { error: "Vote is not active", code: "VOTE_NOT_ACTIVE" },
      { status: 409 }
    );
  }

  const [membersRes, votesRes] = await Promise.all([
    db
      .from("group_members")
      .select("line_user_id, display_name")
      .eq("group_id", auth.groupId)
      .is("left_at", null),
    db
      .from("votes")
      .select("line_user_id")
      .eq("trip_item_id", itemId),
  ]);

  if (membersRes.error || votesRes.error) {
    return NextResponse.json(
      { error: "Failed to load vote state", code: "DB_ERROR" },
      { status: 500 }
    );
  }

  const members = membersRes.data ?? [];
  const voted = new Set(
    (votesRes.data ?? []).map((v) => v.line_user_id as string)
  );
  const memberById = new Map<string, string | null>(
    members.map((m) => [
      m.line_user_id as string,
      (m.display_name as string | null) ?? null,
    ])
  );

  // Resolve the candidate recipients
  const allNonVoters = members
    .map((m) => m.line_user_id as string)
    .filter((id) => !voted.has(id) && id !== auth.lineUserId);

  const targets = requestedIds
    ? Array.from(new Set(requestedIds))
    : allNonVoters;

  // Cooldown lookup — recent nudge_sent events for this item
  const cooldownCutoff = new Date(
    Date.now() - NUDGE_COOLDOWN_MS
  ).toISOString();
  const { data: recentNudges } = await db
    .from("analytics_events")
    .select("user_id, created_at, properties")
    .eq("event_name", "nudge_sent")
    .gte("created_at", cooldownCutoff);

  const lastNudgedAt = new Map<string, string>();
  for (const row of recentNudges ?? []) {
    const props = (row.properties as Record<string, unknown> | null) ?? {};
    if (props.tripItemId !== itemId) continue;
    const uid = (row.user_id as string | null) ?? null;
    if (!uid) continue;
    const ts = row.created_at as string;
    const prev = lastNudgedAt.get(uid);
    if (!prev || prev < ts) lastNudgedAt.set(uid, ts);
  }

  const nudged: NudgeResponse["nudged"] = [];
  const skipped: NudgeResponse["skipped"] = [];

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  const voteUrl = appUrl
    ? `${appUrl}/app/trips/${tripId}/votes`
    : `/app/trips/${tripId}/votes`;
  const deadlineHint = item.deadline_at
    ? ` (closes ${formatDeadline(item.deadline_at as string)})`
    : "";
  const messageFor = (name: string | null): string =>
    `Hey${name ? " " + name : ""}, your group is waiting on your vote for "${item.title}"${deadlineHint}.\nCast your vote: ${voteUrl}`;

  for (const uid of targets) {
    if (!memberById.has(uid)) {
      skipped.push({
        lineUserId: uid,
        displayName: null,
        reason: "not_a_member",
      });
      continue;
    }
    const name = memberById.get(uid) ?? null;
    if (voted.has(uid)) {
      skipped.push({
        lineUserId: uid,
        displayName: name,
        reason: "already_voted",
      });
      continue;
    }
    const last = lastNudgedAt.get(uid);
    if (last) {
      const next = new Date(
        new Date(last).getTime() + NUDGE_COOLDOWN_MS
      ).toISOString();
      skipped.push({
        lineUserId: uid,
        displayName: name,
        reason: "cooldown",
        nextAllowedAt: next,
      });
      continue;
    }

    try {
      await pushText(uid, messageFor(name));
      nudged.push({ lineUserId: uid, displayName: name });
      await track("nudge_sent", {
        groupId: auth.groupId,
        userId: uid,
        properties: {
          tripItemId: itemId,
          tripId,
          nudgedBy: auth.lineUserId,
          itemTitle: item.title,
        },
      });
    } catch (err) {
      // Push can fail (user blocked the bot, etc.) — surface as skipped, not 500.
      skipped.push({
        lineUserId: uid,
        displayName: name,
        reason: "cooldown",
        nextAllowedAt: new Date(
          Date.now() + NUDGE_COOLDOWN_MS
        ).toISOString(),
      });
      console.warn("Nudge push failed", {
        tripItemId: itemId,
        recipient: uid,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json<NudgeResponse>({ nudged, skipped });
}

function formatDeadline(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const now = Date.now();
  const diffMs = d.getTime() - now;
  if (diffMs <= 0) return "overdue";
  const hours = Math.round(diffMs / 3_600_000);
  if (hours < 24) return `in ${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `in ${days}d`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

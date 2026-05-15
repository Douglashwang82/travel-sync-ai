import { createAdminClient } from "@/lib/db";
import {
  fetchGroupMemberProfile,
  getAllGroupMemberIds,
} from "@/lib/line";

/**
 * Mirror every active LINE group member into `trip_members` for the given trip.
 *
 * `group_members` already grants implicit access to a trip (see the
 * trip-access checks in `lib/app-server.ts`), but materializing rows in
 * `trip_members` lets the trip survive the LINE group going away and surfaces
 * everyone in the web app's "trip members" list without a join through
 * `group_members`.
 *
 * When `lineGroupId` is provided, the function first asks LINE for the full
 * roster (`getGroupMembersIds`) and backfills any missing `group_members`
 * rows so silent group members get included. The LINE call requires a
 * verified or premium official account; if it fails we fall back to whoever
 * is already in `group_members`. Idempotent — safe to call repeatedly.
 */
export async function addLineGroupMembersToTrip(
  tripId: string,
  dbGroupId: string,
  lineGroupId?: string
): Promise<number> {
  const db = createAdminClient();

  if (lineGroupId) {
    await syncLineRosterIntoGroupMembers(dbGroupId, lineGroupId);
  }

  const { data: groupMembers, error: gmErr } = await db
    .from("group_members")
    .select("line_user_id, display_name, role")
    .eq("group_id", dbGroupId)
    .is("left_at", null);

  if (gmErr) {
    console.error("[trip-members] failed to load group_members", gmErr);
    return 0;
  }
  if (!groupMembers || groupMembers.length === 0) return 0;

  // Ensure every LINE user has an `app_users` row so we can FK into it.
  await db.from("app_users").upsert(
    groupMembers.map((m) => ({
      line_user_id: m.line_user_id as string,
      display_name: (m.display_name as string | null) ?? null,
    })),
    { onConflict: "line_user_id", ignoreDuplicates: true }
  );

  const lineUserIds = groupMembers.map((m) => m.line_user_id as string);
  const { data: appUsers, error: auErr } = await db
    .from("app_users")
    .select("id, line_user_id")
    .in("line_user_id", lineUserIds);

  if (auErr || !appUsers) {
    console.error("[trip-members] failed to load app_users", auErr);
    return 0;
  }

  const roleByLineId = new Map(
    groupMembers.map((m) => [m.line_user_id as string, m.role as string])
  );

  const rows = appUsers.map((au) => ({
    trip_id: tripId,
    app_user_id: au.id as string,
    line_user_id: au.line_user_id as string,
    role: roleByLineId.get(au.line_user_id as string) ?? "member",
  }));

  const { error: insertErr } = await db
    .from("trip_members")
    .upsert(rows, { onConflict: "trip_id,app_user_id", ignoreDuplicates: true });

  if (insertErr) {
    console.error("[trip-members] failed to upsert trip_members", insertErr);
    return 0;
  }

  return rows.length;
}

/**
 * Pull the full LINE group roster and upsert any users that aren't already
 * tracked in `group_members`. Profile lookups run in parallel because each one
 * is its own HTTP round-trip; failures are tolerated per-user.
 */
async function syncLineRosterIntoGroupMembers(
  dbGroupId: string,
  lineGroupId: string
): Promise<void> {
  const memberIds = await getAllGroupMemberIds(lineGroupId);
  if (!memberIds || memberIds.length === 0) return;

  const db = createAdminClient();

  const { data: known } = await db
    .from("group_members")
    .select("line_user_id")
    .eq("group_id", dbGroupId)
    .in("line_user_id", memberIds);

  const knownIds = new Set((known ?? []).map((r) => r.line_user_id as string));
  const missing = memberIds.filter((id) => !knownIds.has(id));
  if (missing.length === 0) return;

  const profiles = await Promise.all(
    missing.map((id) => fetchGroupMemberProfile(lineGroupId, id))
  );

  const rows = missing.map((line_user_id, i) => ({
    group_id: dbGroupId,
    line_user_id,
    display_name: profiles[i]?.displayName ?? null,
    role: "member" as const,
  }));

  const { error } = await db
    .from("group_members")
    .upsert(rows, { onConflict: "group_id,line_user_id", ignoreDuplicates: true });

  if (error) {
    console.error("[trip-members] failed to upsert group_members from LINE roster", error);
  }
}

import { createAdminClient } from "@/lib/db";

/**
 * Mirror every active LINE group member into `trip_members` for the given trip.
 *
 * `group_members` already grants implicit access to a trip (see the
 * trip-access checks in `lib/app-server.ts`), but materializing rows in
 * `trip_members` lets the trip survive the LINE group going away and surfaces
 * everyone in the web app's "trip members" list without a join through
 * `group_members`. Idempotent — safe to call repeatedly.
 */
export async function addLineGroupMembersToTrip(
  tripId: string,
  dbGroupId: string
): Promise<number> {
  const db = createAdminClient();

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

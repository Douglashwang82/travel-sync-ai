import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/db";
import { readAppSessionCookie } from "@/lib/app-server";
import { ProfileClient, type ProfileInitial } from "@/components/app/profile-client";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Profile — TravelSync",
};

async function loadInitialProfile(lineUserId: string): Promise<ProfileInitial | null> {
  const db = createAdminClient();

  const { data: user } = await db
    .from("app_users")
    .select("id, email, display_name, line_user_id, avatar_url, created_at, updated_at")
    .eq("line_user_id", lineUserId)
    .maybeSingle();

  if (!user) return null;

  const [{ count: groupCount }, { count: tripMemberCount }, { data: groupRows }] =
    await Promise.all([
      db
        .from("group_members")
        .select("id", { count: "exact", head: true })
        .eq("line_user_id", lineUserId)
        .is("left_at", null),
      db
        .from("trip_members")
        .select("id", { count: "exact", head: true })
        .eq("app_user_id", user.id as string)
        .is("left_at", null),
      db
        .from("group_members")
        .select("group_id")
        .eq("line_user_id", lineUserId)
        .is("left_at", null),
    ]);

  let tripsViaGroups = 0;
  const groupIds = (groupRows ?? []).map((r) => r.group_id as string).filter(Boolean);
  if (groupIds.length > 0) {
    const { count } = await db
      .from("trips")
      .select("id", { count: "exact", head: true })
      .in("group_id", groupIds);
    tripsViaGroups = count ?? 0;
  }

  return {
    appUserId: user.id as string,
    lineUserId: user.line_user_id as string,
    email: (user.email as string | null) ?? null,
    displayName: (user.display_name as string | null) ?? null,
    avatarUrl: (user.avatar_url as string | null) ?? null,
    createdAt: user.created_at as string,
    updatedAt: user.updated_at as string,
    groupCount: groupCount ?? 0,
    tripCount: tripsViaGroups + (tripMemberCount ?? 0),
  };
}

export default async function ProfilePage() {
  const lineUserId = await readAppSessionCookie();
  if (!lineUserId) redirect("/app/sign-in?next=/app/profile");

  const initial = await loadInitialProfile(lineUserId);
  if (!initial) redirect("/app/sign-in?next=/app/profile");

  return <ProfileClient initial={initial} />;
}

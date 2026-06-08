import { TripGroupChat } from "@/components/app/trip-group-chat";
import { readAppSessionCookie } from "@/lib/app-server";
import { createAdminClient } from "@/lib/db";

/**
 * The trip workspace landing page: a shared group chat room for every member
 * with the AI planner participating. Access is already guarded by the trip
 * layout; we resolve the caller's app_user id here to mark the chat's own
 * messages as "mine". The bento overview now lives at /overview.
 */
export default async function TripChatPage({
  params,
}: {
  params: Promise<{ tripId: string }>;
}) {
  const { tripId } = await params;

  let appUserId: string | null = null;
  const lineUserId = await readAppSessionCookie();
  if (lineUserId) {
    const db = createAdminClient();
    const { data: appUser } = await db
      .from("app_users")
      .select("id")
      .eq("line_user_id", lineUserId)
      .maybeSingle();
    appUserId = (appUser?.id as string | null) ?? null;
  }

  return <TripGroupChat tripId={tripId} currentAppUserId={appUserId} />;
}

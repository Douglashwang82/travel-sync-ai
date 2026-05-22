import { redirect, notFound } from "next/navigation";
import { createAdminClient } from "@/lib/db";
import { readAppSessionCookie } from "@/lib/app-server";
import { MainMapPage } from "@/components/app/main-map-page";

export const dynamic = "force-dynamic";

export default async function MapRoute({
  params,
}: {
  params: Promise<{ tripId: string }>;
}) {
  const { tripId } = await params;

  const lineUserId = await readAppSessionCookie();
  if (!lineUserId) redirect(`/app/sign-in?next=/app/trips/${tripId}/map`);

  const db = createAdminClient();
  const { data: trip } = await db
    .from("trips")
    .select("id, group_id")
    .eq("id", tripId)
    .single();
  if (!trip) notFound();

  // Determine edit rights — organizers can add places from search.
  let role: "organizer" | "member" | null = null;
  if (trip.group_id) {
    const { data: gm } = await db
      .from("group_members")
      .select("role")
      .eq("group_id", trip.group_id as string)
      .eq("line_user_id", lineUserId)
      .is("left_at", null)
      .maybeSingle();
    if (gm) {
      role = (gm.role as string) === "organizer" ? "organizer" : "member";
    }
  }
  if (!role) {
    const { data: tm } = await db
      .from("trip_members")
      .select("role")
      .eq("trip_id", tripId)
      .eq("line_user_id", lineUserId)
      .is("left_at", null)
      .maybeSingle();
    if (!tm) notFound();
    role = (tm.role as string) === "organizer" ? "organizer" : "member";
  }

  return <MainMapPage tripId={tripId} canEdit={role === "organizer"} />;
}

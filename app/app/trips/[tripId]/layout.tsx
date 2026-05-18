import type { ReactNode } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { createAdminClient } from "@/lib/db";
import { parseAppLocale, type AppLocale } from "@/lib/app-locale";
import { readAppSessionCookie } from "@/lib/app-server";
import type { Trip } from "@/lib/types";
import { TripChatNavbar } from "@/components/app/trip-chat-navbar";

export const dynamic = "force-dynamic";

const COPY: Record<
  AppLocale,
  {
    trips: string;
    untitledTrip: string;
    you: string;
    role: Record<"organizer" | "member", string>;
    statusActive: string;
  }
> = {
  en: {
    trips: "Trips",
    untitledTrip: "Untitled trip",
    you: "You",
    role: { organizer: "Organizer", member: "Member" },
    statusActive: "Active",
  },
  "zh-TW": {
    trips: "旅程",
    untitledTrip: "未命名旅程",
    you: "你",
    role: { organizer: "主辦人", member: "成員" },
    statusActive: "進行中",
  },
};

interface TripContextSummary {
  trip: Trip;
  role: "organizer" | "member";
  groupName: string | null;
  appUserId: string | null;
}

async function loadTripContext(
  tripId: string,
  lineUserId: string
): Promise<TripContextSummary | null> {
  const db = createAdminClient();
  const { data: trip } = await db.from("trips").select("*").eq("id", tripId).single();
  if (!trip) return null;

  const { data: appUser } = await db
    .from("app_users")
    .select("id")
    .eq("line_user_id", lineUserId)
    .maybeSingle();
  const appUserId = (appUser?.id as string | null) ?? null;

  const groupId = (trip.group_id as string | null) ?? null;
  let role: "organizer" | "member" | null = null;
  let groupName: string | null = null;

  if (groupId) {
    const { data: membership } = await db
      .from("group_members")
      .select("role")
      .eq("group_id", groupId)
      .eq("line_user_id", lineUserId)
      .is("left_at", null)
      .maybeSingle();

    if (membership) {
      role = (membership.role as string) === "organizer" ? "organizer" : "member";
    }

    const { data: group } = await db
      .from("line_groups")
      .select("name")
      .eq("id", groupId)
      .maybeSingle();
    groupName = (group?.name as string | null) ?? null;
  }

  if (!role) {
    const { data: tripMember } = await db
      .from("trip_members")
      .select("role")
      .eq("trip_id", tripId)
      .eq("line_user_id", lineUserId)
      .is("left_at", null)
      .maybeSingle();

    if (!tripMember) return null;
    role = (tripMember.role as string) === "organizer" ? "organizer" : "member";
  }

  return {
    trip: trip as Trip,
    role,
    groupName,
    appUserId,
  };
}

export default async function TripLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ tripId: string }>;
}) {
  const { tripId } = await params;
  const lineUserId = await readAppSessionCookie();
  if (!lineUserId) redirect(`/app/sign-in?next=/app/trips/${tripId}`);

  const locale = parseAppLocale((await cookies()).get("travelsync-app-locale")?.value);
  const copy = COPY[locale];
  const ctx = await loadTripContext(tripId, lineUserId);
  if (!ctx) notFound();

  const { trip, role, groupName, appUserId } = ctx;

  /*
   * Layout no longer renders the hero — that responsibility moved into the
   * Overview bento (`TripHeroTile`). What remains here is the breadcrumb +
   * a thin status row, the sticky tab strip, and the tab content.
   */
  return (
    <div id="trip-layout" className="space-y-4">
      <nav id="trip-breadcrumb" className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
        <Link href="/app" className="hover:text-[var(--text-primary)]">
          {copy.trips}
        </Link>
        <span aria-hidden className="text-[var(--text-faint)]">/</span>
        <span className="text-[var(--text-primary)]">
          {trip.destination_name ?? copy.untitledTrip}
        </span>
        <span aria-hidden className="text-[var(--text-faint)]">·</span>
        <span
          className={
            trip.status === "active"
              ? "rounded-full bg-[var(--status-settled-soft)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--status-settled)]"
              : "rounded-full bg-[var(--surface-sunken)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]"
          }
        >
          {trip.status === "active" ? copy.statusActive : trip.status}
        </span>
        {groupName && (
          <span className="rounded-full bg-[var(--surface-sunken)] px-2 py-0.5 text-[10px] font-medium text-[var(--text-muted)]">
            {groupName}
          </span>
        )}
        <span className="rounded-full bg-[var(--surface-sunken)] px-2 py-0.5 text-[10px] font-medium text-[var(--text-muted)]">
          {copy.you}: {copy.role[role]}
        </span>
        {appUserId && (
          <TripChatNavbar tripId={tripId} currentAppUserId={appUserId} />
        )}
      </nav>

      <div id="trip-content" className="pt-2">{children}</div>
    </div>
  );
}

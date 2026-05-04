import type { ReactNode } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { createAdminClient } from "@/lib/db";
import { getIntlLocale, parseAppLocale, type AppLocale } from "@/lib/app-locale";
import { readAppSessionCookie } from "@/lib/app-server";
import type { Trip } from "@/lib/types";
import { TripTabs } from "@/components/app/trip-tabs";

export const dynamic = "force-dynamic";

const COPY: Record<
  AppLocale,
  {
    trips: string;
    untitledTrip: string;
    datesTbd: string;
    you: string;
    role: Record<"organizer" | "member", string>;
    status: Record<string, string>;
    openInMaps: string;
  }
> = {
  en: {
    trips: "Trips",
    untitledTrip: "Untitled trip",
    datesTbd: "Dates to be decided",
    you: "You",
    role: {
      organizer: "organizer",
      member: "member",
    },
    status: {
      active: "active",
      draft: "draft",
      archived: "archived",
      completed: "completed",
      cancelled: "cancelled",
    },
    openInMaps: "Open in Maps",
  },
  "zh-TW": {
    trips: "旅程",
    untitledTrip: "未命名旅程",
    datesTbd: "日期尚未決定",
    you: "你的身分",
    role: {
      organizer: "發起人",
      member: "成員",
    },
    status: {
      active: "進行中",
      draft: "草稿",
      archived: "已封存",
      completed: "已完成",
      cancelled: "已取消",
    },
    openInMaps: "在地圖中開啟",
  },
};

async function loadTripContext(tripId: string, lineUserId: string): Promise<
  | { trip: Trip; role: "organizer" | "member"; groupName: string | null }
  | null
> {
  const db = createAdminClient();
  const { data: trip } = await db
    .from("trips")
    .select("*")
    .eq("id", tripId)
    .single();
  if (!trip) return null;

  const { data: membership } = await db
    .from("group_members")
    .select("role")
    .eq("group_id", trip.group_id)
    .eq("line_user_id", lineUserId)
    .is("left_at", null)
    .single();

  if (!membership) return null;

  const { data: group } = await db
    .from("line_groups")
    .select("name")
    .eq("id", trip.group_id)
    .single();

  return {
    trip: trip as Trip,
    role: (membership.role as string) === "organizer" ? "organizer" : "member",
    groupName: (group?.name as string | null) ?? null,
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

  const { trip, role, groupName } = ctx;
  const dateLabel =
    trip.start_date && trip.end_date
      ? `${formatDate(trip.start_date, locale)} — ${formatDate(trip.end_date, locale)}`
      : copy.datesTbd;

  return (
    <div className="space-y-6">
      <nav className="text-xs text-[var(--muted-foreground)]">
        <Link href="/app" className="hover:text-[var(--foreground)]">
          {copy.trips}
        </Link>
        <span className="mx-1.5">/</span>
        <span className="text-[var(--foreground)]">
          {trip.destination_name ?? copy.untitledTrip}
        </span>
      </nav>

      <header className="rounded-3xl border border-[var(--border)] bg-[var(--background)] p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
              <span className="rounded-full bg-[var(--secondary)] px-2 py-0.5 capitalize">
                {copy.status[trip.status] ?? trip.status}
              </span>
              {groupName && (
                <span className="rounded-full bg-[var(--secondary)] px-2 py-0.5 normal-case">
                  {groupName}
                </span>
              )}
              <span className="rounded-full bg-[var(--secondary)] px-2 py-0.5 capitalize">
                {copy.you}: {copy.role[role]}
              </span>
            </div>
            <h1 className="text-2xl font-bold text-[var(--foreground)] sm:text-3xl">
              {trip.destination_name ?? copy.untitledTrip}
              {trip.title && trip.title !== trip.destination_name && (
                <span className="ml-2 text-base font-normal text-[var(--muted-foreground)]">
                  · {trip.title}
                </span>
              )}
            </h1>
            <p className="text-sm text-[var(--muted-foreground)]">{dateLabel}</p>
            {trip.destination_formatted_address && (
              <p className="text-xs text-[var(--muted-foreground)]">
                {trip.destination_formatted_address}
              </p>
            )}
          </div>

          {trip.destination_google_maps_url && (
            <a
              href={trip.destination_google_maps_url}
              target="_blank"
              rel="noreferrer"
              className="rounded-full border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--secondary)]"
            >
              {copy.openInMaps}
            </a>
          )}
        </div>
      </header>

      <TripTabs tripId={tripId} />

      <div>{children}</div>
    </div>
  );
}

function formatDate(iso: string, locale: AppLocale): string {
  const d = new Date(iso + "T00:00:00");
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(getIntlLocale(locale), {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

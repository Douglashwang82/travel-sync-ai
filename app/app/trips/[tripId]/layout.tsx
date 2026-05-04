import type { ReactNode } from "react";
import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createAdminClient } from "@/lib/db";
import { readAppSessionCookie } from "@/lib/app-server";
import type { Trip } from "@/lib/types";
import { TripTabs } from "@/components/app/trip-tabs";

export const dynamic = "force-dynamic";

interface TripContextSummary {
  trip: Trip;
  role: "organizer" | "member";
  groupName: string | null;
  lineGroupId: string | null;
  memberCount: number;
  confirmedCount: number;
  pendingCount: number;
  todoCount: number;
}

async function loadTripContext(
  tripId: string,
  lineUserId: string
): Promise<TripContextSummary | null> {
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

  const [{ data: group }, { count: memberCount }, { data: stages }] =
    await Promise.all([
      db
        .from("line_groups")
        .select("name, line_group_id")
        .eq("id", trip.group_id)
        .single(),
      db
        .from("group_members")
        .select("*", { count: "exact", head: true })
        .eq("group_id", trip.group_id)
        .is("left_at", null),
      db.from("trip_items").select("stage").eq("trip_id", tripId),
    ]);

  const confirmedCount =
    stages?.filter((s) => s.stage === "confirmed").length ?? 0;
  const pendingCount =
    stages?.filter((s) => s.stage === "pending").length ?? 0;
  const todoCount = stages?.filter((s) => s.stage === "todo").length ?? 0;

  return {
    trip: trip as Trip,
    role: (membership.role as string) === "organizer" ? "organizer" : "member",
    groupName: (group?.name as string | null) ?? null,
    lineGroupId: (group?.line_group_id as string | null) ?? null,
    memberCount: memberCount ?? 0,
    confirmedCount,
    pendingCount,
    todoCount,
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

  const ctx = await loadTripContext(tripId, lineUserId);
  if (!ctx) notFound();

  const {
    trip,
    role,
    groupName,
    lineGroupId,
    memberCount,
    confirmedCount,
    pendingCount,
  } = ctx;
  const dateLabel =
    trip.start_date && trip.end_date
      ? `${formatDate(trip.start_date)} — ${formatDate(trip.end_date)}`
      : "Dates to be decided";

  const lineDeepLink = lineGroupId
    ? `https://line.me/R/oaMessage/${encodeURIComponent("@travel-sync")}/?${encodeURIComponent(`Open trip ${trip.destination_name ?? ""}`)}`
    : null;

  return (
    <div className="space-y-5">
      <nav className="text-xs text-[var(--muted-foreground)]">
        <Link href="/app" className="hover:text-[var(--foreground)]">
          Trips
        </Link>
        <span className="mx-1.5">/</span>
        <span className="text-[var(--foreground)]">
          {trip.destination_name ?? "Untitled trip"}
        </span>
      </nav>

      <header className="rounded-3xl border border-[var(--border)] bg-gradient-to-br from-[var(--background)] to-[var(--secondary)]/40 p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
              <span
                className={
                  trip.status === "active"
                    ? "rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                    : "rounded-full bg-[var(--secondary)] px-2 py-0.5 capitalize"
                }
              >
                {trip.status}
              </span>
              {groupName && (
                <span className="rounded-full bg-[var(--secondary)] px-2 py-0.5 normal-case">
                  {groupName}
                </span>
              )}
              <span className="rounded-full bg-[var(--secondary)] px-2 py-0.5 capitalize">
                You: {role}
              </span>
            </div>
            <h1 className="text-2xl font-bold text-[var(--foreground)] sm:text-3xl">
              {trip.destination_name ?? "Untitled trip"}
              {trip.title && trip.title !== trip.destination_name && (
                <span className="ml-2 text-base font-normal text-[var(--muted-foreground)]">
                  · {trip.title}
                </span>
              )}
            </h1>
            <p className="text-sm text-[var(--muted-foreground)]">
              {dateLabel}
              <span className="mx-2 text-[var(--border)]">·</span>
              {memberCount} traveler{memberCount === 1 ? "" : "s"}
              <span className="mx-2 text-[var(--border)]">·</span>
              <span className="font-medium text-emerald-700 dark:text-emerald-300">
                {confirmedCount} confirmed
              </span>
              {pendingCount > 0 && (
                <>
                  <span className="mx-2 text-[var(--border)]">·</span>
                  <span className="font-medium text-amber-700 dark:text-amber-300">
                    {pendingCount} pending
                  </span>
                </>
              )}
            </p>
            {trip.destination_formatted_address && (
              <p className="text-xs text-[var(--muted-foreground)]">
                {trip.destination_formatted_address}
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {lineDeepLink && (
              <a
                href={lineDeepLink}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-full bg-[#06c755] px-4 py-2 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
              >
                <span aria-hidden>💬</span>
                Open in LINE
              </a>
            )}
            <Link
              href={`/app/trips/${tripId}/settings`}
              className="rounded-full border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--secondary)]"
            >
              Invite member
            </Link>
            {trip.destination_google_maps_url && (
              <a
                href={trip.destination_google_maps_url}
                target="_blank"
                rel="noreferrer"
                className="rounded-full border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--secondary)]"
              >
                Open in Maps
              </a>
            )}
          </div>
        </div>
      </header>

      <TripTabs tripId={tripId} />

      <div>{children}</div>
    </div>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

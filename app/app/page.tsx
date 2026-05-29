import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Plus } from "lucide-react";
import { createAdminClient } from "@/lib/db";
import { getIntlLocale, parseAppLocale, type AppLocale } from "@/lib/app-locale";
import { readAppSessionCookie } from "@/lib/app-server";
import { Button } from "@/components/ui/button";
import { TripCardDeleteButton } from "@/components/app/trip-card-delete-button";
import { Reveal, Stagger, StaggerItem } from "@/components/motion";

export const dynamic = "force-dynamic";

interface TripRow {
  id: string;
  group_id: string | null;
  destination_name: string | null;
  start_date: string | null;
  end_date: string | null;
  status: string;
  itemCount: number;
  groupName: string | null;
  role: "organizer" | "member";
}

const COPY: Record<
  AppLocale,
  {
    heading: string;
    subheading: string;
    totalTrips: (count: number) => string;
    activeSection: string;
    pastSection: string;
    emptyTitle: string;
    emptyBody: string;
    startWizard: string;
    howItWorks: string;
    datesTbd: string;
    untitledTrip: string;
    lineGroup: string;
    open: string;
    items: (count: number) => string;
    status: Record<string, string>;
    deleteLabel: string;
    deleteConfirm: (label: string) => string;
  }
> = {
  en: {
    heading: "Your trips",
    subheading: "Every trip your LINE groups are planning, in one place.",
    totalTrips: (count) => `${count} trip${count === 1 ? "" : "s"} total`,
    activeSection: "Active & drafts",
    pastSection: "Past trips",
    emptyTitle: "No trips yet",
    emptyBody:
      "Add the TravelSync bot to a LINE group and type /start Niseko Jan 5-12 to create your first trip. It will show up here automatically.",
    startWizard: "Plan new trip",
    howItWorks: "How it works",
    datesTbd: "Dates to be decided",
    untitledTrip: "Untitled trip",
    lineGroup: "LINE group",
    open: "Open →",
    items: (count) => `${count} item${count === 1 ? "" : "s"}`,
    status: {
      active: "active",
      draft: "draft",
      archived: "archived",
      completed: "completed",
      cancelled: "cancelled",
    },
    deleteLabel: "Delete trip",
    deleteConfirm: (label) =>
      `Delete "${label}"? This permanently removes the trip and all its items, votes, documents, and packing lists.`,
  },
  "zh-TW": {
    heading: "你的旅程",
    subheading: "把所有 LINE 群組正在規劃的旅程集中在同一個地方。",
    totalTrips: (count) => `共 ${count} 個旅程`,
    activeSection: "進行中與草稿",
    pastSection: "過往旅程",
    emptyTitle: "還沒有旅程",
    emptyBody:
      "把 TravelSync 機器人加入 LINE 群組，並輸入 /start Niseko Jan 5-12 建立第一個旅程。建立後會自動顯示在這裡。",
    startWizard: "建立新旅程",
    howItWorks: "查看介紹",
    datesTbd: "日期尚未決定",
    untitledTrip: "未命名旅程",
    lineGroup: "LINE 群組",
    open: "開啟 →",
    items: (count) => `${count} 個項目`,
    status: {
      active: "進行中",
      draft: "草稿",
      archived: "已封存",
      completed: "已完成",
      cancelled: "已取消",
    },
    deleteLabel: "刪除旅程",
    deleteConfirm: (label) =>
      `確定要刪除「${label}」嗎？此動作無法復原，所有行程項目、投票、文件、打包清單等將一併刪除。`,
  },
};

async function loadTripsForUser(lineUserId: string): Promise<TripRow[]> {
  const db = createAdminClient();

  // 1) Resolve the app_users row so we can also pull trip_members trips.
  const { data: appUser } = await db
    .from("app_users")
    .select("id")
    .eq("line_user_id", lineUserId)
    .maybeSingle();
  const appUserId = (appUser?.id as string | null) ?? null;

  // 2) Trips reachable via LINE group_members.
  const { data: memberships } = await db
    .from("group_members")
    .select("group_id, role, line_groups!inner(id, name, status)")
    .eq("line_user_id", lineUserId)
    .is("left_at", null);

  const groups = (memberships ?? [])
    .map((m) => {
      const g = Array.isArray(m.line_groups) ? m.line_groups[0] : m.line_groups;
      return g
        ? {
            id: g.id as string,
            name: (g.name as string | null) ?? null,
            status: g.status as string,
            role: ((m.role as string) === "organizer" ? "organizer" : "member") as
              | "organizer"
              | "member",
          }
        : null;
    })
    .filter(
      (g): g is { id: string; name: string | null; status: string; role: "organizer" | "member" } =>
        g !== null && g.status !== "removed"
    );

  const groupNameById = new Map(groups.map((g) => [g.id, g.name]));
  const groupRoleById = new Map(groups.map((g) => [g.id, g.role]));
  const tripsById = new Map<string, TripRow>();

  if (groups.length > 0) {
    const groupIds = groups.map((g) => g.id);
    const { data: tripRows } = await db
      .from("trips")
      .select("id, group_id, destination_name, start_date, end_date, status, created_at")
      .in("group_id", groupIds)
      .order("created_at", { ascending: false });

    for (const t of tripRows ?? []) {
      const id = t.id as string;
      const gid = (t.group_id as string | null) ?? null;
      tripsById.set(id, {
        id,
        group_id: gid,
        destination_name: (t.destination_name as string | null) ?? null,
        start_date: (t.start_date as string | null) ?? null,
        end_date: (t.end_date as string | null) ?? null,
        status: t.status as string,
        itemCount: 0,
        groupName: gid ? (groupNameById.get(gid) ?? null) : null,
        role: (gid ? groupRoleById.get(gid) : null) ?? "member",
      });
    }
  }

  // 3) Trips reachable via direct trip_members membership.
  if (appUserId) {
    const { data: directRows } = await db
      .from("trip_members")
      .select(
        "role, trips!inner(id, group_id, destination_name, start_date, end_date, status, created_at, line_groups(id, name))"
      )
      .eq("app_user_id", appUserId)
      .is("left_at", null);

    for (const row of directRows ?? []) {
      const t = Array.isArray(row.trips) ? row.trips[0] : row.trips;
      if (!t) continue;
      const id = t.id as string;
      const tripMemberRole: "organizer" | "member" =
        (row.role as string) === "organizer" ? "organizer" : "member";
      if (tripsById.has(id)) {
        // Upgrade role to organizer if trip_members says so but group membership didn't.
        const existing = tripsById.get(id)!;
        if (existing.role !== "organizer" && tripMemberRole === "organizer") {
          existing.role = "organizer";
        }
        continue;
      }
      const lg = Array.isArray(t.line_groups) ? t.line_groups[0] : t.line_groups;
      tripsById.set(id, {
        id,
        group_id: (t.group_id as string | null) ?? null,
        destination_name: (t.destination_name as string | null) ?? null,
        start_date: (t.start_date as string | null) ?? null,
        end_date: (t.end_date as string | null) ?? null,
        status: t.status as string,
        itemCount: 0,
        groupName: (lg?.name as string | null) ?? null,
        role: tripMemberRole,
      });
    }
  }

  const tripIds = Array.from(tripsById.keys());
  if (tripIds.length > 0) {
    const { data: itemRows } = await db
      .from("trip_items")
      .select("trip_id")
      .in("trip_id", tripIds);
    for (const item of itemRows ?? []) {
      const row = tripsById.get(item.trip_id as string);
      if (row) row.itemCount += 1;
    }
  }

  return Array.from(tripsById.values());
}

export default async function AppTripsPage() {
  const lineUserId = await readAppSessionCookie();
  if (!lineUserId) {
    redirect("/app/sign-in");
  }

  const locale = parseAppLocale((await cookies()).get("travelsync-app-locale")?.value);
  const copy = COPY[locale];
  const trips = await loadTripsForUser(lineUserId);
  const [active, other] = partitionTrips(trips);

  return (
    <div className="space-y-8">
      <Reveal
        as="section"
        className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"
      >
        <div>
          <h1 className="text-display text-3xl text-gradient sm:text-4xl">{copy.heading}</h1>
          <p className="mt-2 text-sm text-[var(--text-muted)]">
            {copy.subheading}
          </p>
        </div>
        <div className="flex flex-col items-start gap-3 sm:items-end">
          <Button asChild variant="gradient" size="lg">
            <Link href="/app/trips/new">
              <Plus className="size-4" aria-hidden="true" />
              {copy.startWizard}
            </Link>
          </Button>
          <div className="text-xs text-[var(--text-muted)]">{copy.totalTrips(trips.length)}</div>
        </div>
      </Reveal>

      {trips.length === 0 && <EmptyTrips locale={locale} />}

      {active.length > 0 && (
        <Section id="active-trips" title={copy.activeSection}>
          <TripGrid trips={active} locale={locale} />
        </Section>
      )}

      {other.length > 0 && (
        <Section id="past-trips" title={copy.pastSection}>
          <TripGrid trips={other} locale={locale} dim />
        </Section>
      )}
    </div>
  );
}

function partitionTrips(trips: TripRow[]): [TripRow[], TripRow[]] {
  const active: TripRow[] = [];
  const other: TripRow[] = [];
  for (const t of trips) {
    if (t.status === "active" || t.status === "draft") active.push(t);
    else other.push(t);
  }
  return [active, other];
}

function EmptyTrips({ locale }: { locale: AppLocale }) {
  const copy = COPY[locale];

  return (
    <Reveal className="relative overflow-hidden rounded-3xl border border-dashed border-[var(--border-strong)] bg-[var(--surface-raised)] px-6 py-14 text-center">
      <div aria-hidden className="hero-mesh" />
      <div className="relative">
        <p className="text-display text-lg text-[var(--text-primary)]">{copy.emptyTitle}</p>
        <p className="mx-auto mt-2 max-w-sm text-xs leading-relaxed text-[var(--text-muted)]">
          {copy.emptyBody.split("/start Niseko Jan 5-12")[0]}
          <code className="text-mono rounded-md bg-[var(--surface-sunken)] px-1.5 py-0.5 text-[11px]">
            /start Niseko Jan 5-12
          </code>{" "}
          {copy.emptyBody.split("/start Niseko Jan 5-12")[1]}
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Button asChild variant="gradient" size="lg">
            <Link href="/app/trips/new">
              <Plus className="size-4" aria-hidden="true" />
              {copy.startWizard}
            </Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link href="/">{copy.howItWorks}</Link>
          </Button>
        </div>
      </div>
    </Reveal>
  );
}

function Section({ id, title, children }: { id?: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id}>
      <h2 className="text-caps mb-3">{title}</h2>
      {children}
    </section>
  );
}

function TripGrid({
  trips,
  locale,
  dim = false,
}: {
  trips: TripRow[];
  locale: AppLocale;
  dim?: boolean;
}) {
  return (
    <Stagger className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {trips.map((t) => (
        <StaggerItem key={t.id}>
          <TripCard trip={t} locale={locale} dim={dim} />
        </StaggerItem>
      ))}
    </Stagger>
  );
}

function TripCard({ trip, locale, dim }: { trip: TripRow; locale: AppLocale; dim: boolean }) {
  const copy = COPY[locale];
  const statusClass =
    trip.status === "active"
      ? "bg-[var(--status-settled-soft)] text-[var(--status-settled)]"
      : trip.status === "draft"
        ? "bg-[var(--status-needs-decision-soft)] text-[var(--status-needs-decision)]"
        : "bg-[var(--surface-sunken)] text-[var(--text-muted)]";

  const dateLabel =
    trip.start_date && trip.end_date
      ? `${formatDate(trip.start_date, locale)} → ${formatDate(trip.end_date, locale)}`
      : copy.datesTbd;

  const tripLabel = trip.destination_name?.trim() || copy.untitledTrip;

  return (
    <Link
      href={`/app/trips/${trip.id}`}
      className={`tile-glow group flex h-full flex-col gap-3 rounded-3xl border border-[var(--border-hairline)] bg-[var(--surface-raised)] p-5 shadow-[var(--shadow-raise)] ${dim ? "opacity-70" : ""}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-base font-semibold text-[var(--text-primary)] transition-colors group-hover:text-[var(--accent-line)]">
            {trip.destination_name ?? copy.untitledTrip}
          </p>
          <p className="mt-0.5 truncate text-xs text-[var(--text-muted)]">
            {trip.groupName ?? copy.lineGroup}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${statusClass}`}>
            {copy.status[trip.status] ?? trip.status}
          </span>
          {trip.role === "organizer" && (
            <TripCardDeleteButton
              tripId={trip.id}
              label={copy.deleteLabel}
              confirmMessage={copy.deleteConfirm(tripLabel)}
              tripLabel={tripLabel}
            />
          )}
        </div>
      </div>
      <p className="text-xs text-[var(--text-muted)]">{dateLabel}</p>
      <div className="mt-auto flex items-center justify-between text-xs text-[var(--text-muted)]">
        <span>{copy.items(trip.itemCount)}</span>
        <span className="font-semibold text-[var(--accent-line)] transition-transform duration-200 group-hover:translate-x-0.5">
          {copy.open}
        </span>
      </div>
    </Link>
  );
}

function formatDate(iso: string, locale: AppLocale): string {
  const d = new Date(iso + "T00:00:00");
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(getIntlLocale(locale), { month: "short", day: "numeric" });
}

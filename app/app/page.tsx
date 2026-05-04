import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/db";
import { getIntlLocale, parseAppLocale, type AppLocale } from "@/lib/app-locale";
import { readAppSessionCookie } from "@/lib/app-server";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

interface TripRow {
  id: string;
  group_id: string;
  destination_name: string | null;
  start_date: string | null;
  end_date: string | null;
  status: string;
  itemCount: number;
  groupName: string | null;
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
    howItWorks: string;
    datesTbd: string;
    untitledTrip: string;
    lineGroup: string;
    open: string;
    items: (count: number) => string;
    status: Record<string, string>;
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
      "Add the TravelSync bot to a LINE group and type /start Osaka Jul 15-20 to create your first trip. It will show up here automatically.",
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
  },
  "zh-TW": {
    heading: "你的旅程",
    subheading: "把所有 LINE 群組正在規劃的旅程集中在同一個地方。",
    totalTrips: (count) => `共 ${count} 個旅程`,
    activeSection: "進行中與草稿",
    pastSection: "過往旅程",
    emptyTitle: "還沒有旅程",
    emptyBody:
      "把 TravelSync 機器人加入 LINE 群組，並輸入 /start Osaka Jul 15-20 建立第一個旅程。建立後會自動顯示在這裡。",
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
  },
};

async function loadTripsForUser(lineUserId: string): Promise<TripRow[]> {
  const db = createAdminClient();

  const { data: memberships } = await db
    .from("group_members")
    .select("group_id, line_groups!inner(id, name, status)")
    .eq("line_user_id", lineUserId)
    .is("left_at", null);

  const groups = (memberships ?? [])
    .map((m) => {
      const g = Array.isArray(m.line_groups) ? m.line_groups[0] : m.line_groups;
      return g ? { id: g.id as string, name: (g.name as string | null) ?? null, status: g.status as string } : null;
    })
    .filter((g): g is { id: string; name: string | null; status: string } => g !== null && g.status !== "removed");

  if (groups.length === 0) return [];

  const groupIds = groups.map((g) => g.id);
  const groupNameById = new Map(groups.map((g) => [g.id, g.name]));

  const { data: tripRows } = await db
    .from("trips")
    .select("id, group_id, destination_name, start_date, end_date, status, created_at")
    .in("group_id", groupIds)
    .order("created_at", { ascending: false });

  const tripIds = (tripRows ?? []).map((t) => t.id as string);
  const itemCounts = new Map<string, number>();
  if (tripIds.length > 0) {
    const { data: itemRows } = await db
      .from("trip_items")
      .select("trip_id")
      .in("trip_id", tripIds);
    for (const item of itemRows ?? []) {
      const key = item.trip_id as string;
      itemCounts.set(key, (itemCounts.get(key) ?? 0) + 1);
    }
  }

  return (tripRows ?? []).map((t) => ({
    id: t.id as string,
    group_id: t.group_id as string,
    destination_name: (t.destination_name as string | null) ?? null,
    start_date: (t.start_date as string | null) ?? null,
    end_date: (t.end_date as string | null) ?? null,
    status: t.status as string,
    itemCount: itemCounts.get(t.id as string) ?? 0,
    groupName: groupNameById.get(t.group_id as string) ?? null,
  }));
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
      <section className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--foreground)]">{copy.heading}</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            {copy.subheading}
          </p>
        </div>
        <div className="text-xs text-[var(--muted-foreground)]">{copy.totalTrips(trips.length)}</div>
      </section>

      {trips.length === 0 && <EmptyTrips locale={locale} />}

      {active.length > 0 && (
        <Section title={copy.activeSection}>
          <TripGrid trips={active} locale={locale} />
        </Section>
      )}

      {other.length > 0 && (
        <Section title={copy.pastSection}>
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
    <div className="rounded-3xl border border-dashed border-[var(--border)] bg-[var(--background)] px-6 py-12 text-center">
      <p className="text-sm font-semibold">{copy.emptyTitle}</p>
      <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-[var(--muted-foreground)]">
        {copy.emptyBody.split("/start Osaka Jul 15-20")[0]}
        <code className="rounded bg-[var(--secondary)] px-1 py-0.5 font-mono text-[11px]">
          /start Osaka Jul 15-20
        </code>{" "}
        {copy.emptyBody.split("/start Osaka Jul 15-20")[1]}
      </p>
      <div className="mt-4">
        <Button asChild variant="outline" className="rounded-full">
          <Link href="/">{copy.howItWorks}</Link>
        </Button>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
        {title}
      </h2>
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
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {trips.map((t) => (
        <TripCard key={t.id} trip={t} locale={locale} dim={dim} />
      ))}
    </div>
  );
}

function TripCard({ trip, locale, dim }: { trip: TripRow; locale: AppLocale; dim: boolean }) {
  const copy = COPY[locale];
  const statusClass =
    trip.status === "active"
      ? "bg-[#dcfce7] text-[#166534] dark:bg-[#14532d] dark:text-[#86efac]"
      : trip.status === "draft"
        ? "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-200"
        : "bg-[var(--secondary)] text-[var(--muted-foreground)]";

  const dateLabel =
    trip.start_date && trip.end_date
      ? `${formatDate(trip.start_date, locale)} → ${formatDate(trip.end_date, locale)}`
      : copy.datesTbd;

  return (
    <Link
      href={`/app/trips/${trip.id}`}
      className={`group flex flex-col gap-3 rounded-2xl border border-[var(--border)] bg-[var(--background)] p-5 transition-colors hover:border-[var(--primary)] hover:shadow-sm ${dim ? "opacity-70" : ""}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-base font-semibold text-[var(--foreground)]">
            {trip.destination_name ?? copy.untitledTrip}
          </p>
          <p className="mt-0.5 truncate text-xs text-[var(--muted-foreground)]">
            {trip.groupName ?? copy.lineGroup}
          </p>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${statusClass}`}>
          {copy.status[trip.status] ?? trip.status}
        </span>
      </div>
      <p className="text-xs text-[var(--muted-foreground)]">{dateLabel}</p>
      <div className="mt-auto flex items-center justify-between text-xs text-[var(--muted-foreground)]">
        <span>{copy.items(trip.itemCount)}</span>
        <span className="font-medium text-[var(--primary)] transition-colors group-hover:underline">
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

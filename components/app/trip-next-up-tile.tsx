"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAppLocale } from "@/components/app/app-locale-provider";
import type { Trip, TripItem } from "@/lib/types";
import { IconArrowUpRight, IconCalendar, IconClock, IconPin } from "@/components/app/icons";

const COPY = {
  en: { title: "Up next", sub: "The closest confirmed beat.", seeAll: "Itinerary", inDays: (n: number) => `In ${n} day${n === 1 ? "" : "s"}`, today: "Today", tomorrow: "Tomorrow", inTrip: (d: number, total: number) => `Day ${d} of ${total}`, nothing: "Nothing scheduled yet. Add something or wait for the group to vote.", pre: (start: string) => `Trip starts ${start}`, over: "Trip ended." },
  "zh-TW": { title: "接下來", sub: "最近一個已確認行程。", seeAll: "行程", inDays: (n: number) => `${n} 天後`, today: "今天", tomorrow: "明天", inTrip: (d: number, total: number) => `第 ${d} / ${total} 天`, nothing: "尚未排定任何事項。先新增一項，或等大家投票。", pre: (start: string) => `${start} 出發`, over: "旅程已結束。" },
} as const;

interface NextUpTileProps {
  tripId: string;
  trip: Trip;
  items: TripItem[];
  onItemClick: (item: TripItem) => void;
}

export function NextUpTile({ tripId, trip, items, onItemClick }: NextUpTileProps) {
  const { locale } = useAppLocale();
  const copy =
    locale === "zh-TW"
      ? {
          title: "接下來",
          sub: "最近一個已確認行程。",
          seeAll: "行程",
          inDays: (n: number) => `${n} 天後`,
          today: "今天",
          tomorrow: "明天",
          inTrip: (d: number, total: number) => `第 ${d} / ${total} 天`,
          nothing: "尚未排定任何事項。先新增一項，或等大家投票。",
          pre: (start: string) => `${start} 出發`,
          over: "旅程已結束。",
        }
      : COPY.en;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const next = pickNextItem(items, now);

  return (
    <section className="surface-tile flex h-full flex-col p-6">
      <header className="flex items-baseline justify-between gap-3">
        <div>
          <h2 className="text-display text-2xl text-[var(--text-primary)]">{copy.title}</h2>
          <p className="mt-1 text-xs text-[var(--text-muted)]">{copy.sub}</p>
        </div>
        <Link
          href={`/app/trips/${tripId}/itinerary`}
          className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--accent-line)] hover:underline"
        >
          {copy.seeAll}
          <IconArrowUpRight size={12} />
        </Link>
      </header>

      {next ? (
        <button
          type="button"
          onClick={() => onItemClick(next)}
          className="tile-interactive group mt-5 flex flex-1 flex-col items-start gap-3 rounded-2xl border border-[var(--border-hairline)] bg-[var(--surface-raised)] p-5 text-left"
        >
          <RelativeWhen iso={next.deadline_at ?? trip.start_date} trip={trip} now={now} copy={copy} />
          <h3 className="text-display text-2xl text-[var(--text-primary)]">{next.title}</h3>
          {next.description && (
            <p className="line-clamp-2 text-sm text-[var(--text-muted)]">{next.description}</p>
          )}
          {trip.destination_formatted_address && (
            <p className="mt-auto inline-flex items-center gap-1 text-xs text-[var(--text-muted)]">
              <IconPin size={12} />
              {trip.destination_formatted_address}
            </p>
          )}
        </button>
      ) : (
        <div className="mt-5 flex flex-1 items-center justify-center rounded-2xl border border-dashed border-[var(--border-hairline)] bg-[var(--surface-sunken)]/40 p-6 text-center">
          <p className="text-sm text-[var(--text-muted)]">
            {trip.start_date && now > new Date(trip.start_date + "T00:00:00").getTime()
              ? copy.nothing
              : trip.start_date
                ? copy.pre(new Date(trip.start_date + "T00:00:00").toLocaleDateString(locale === "zh-TW" ? "zh-TW" : undefined, { month: "short", day: "numeric" }))
                : copy.nothing}
          </p>
        </div>
      )}
    </section>
  );
}

function pickNextItem(items: TripItem[], now: number): TripItem | null {
  const future = items
    .filter((i) => i.deadline_at && new Date(i.deadline_at).getTime() >= now)
    .sort(
      (a, b) => new Date(a.deadline_at!).getTime() - new Date(b.deadline_at!).getTime()
    );
  if (future.length > 0) return future[0];
  const confirmed = items
    .filter((i) => i.stage === "confirmed")
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
  return confirmed[0] ?? null;
}

function RelativeWhen({
  iso,
  trip,
  now,
  copy,
}: {
  iso: string | null;
  trip: Trip;
  now: number;
  copy: {
    today: string;
    tomorrow: string;
    over: string;
    inDays: (n: number) => string;
  };
}) {
  if (!iso && !trip.start_date) {
    return null;
  }
  const target = iso ? new Date(iso).getTime() : new Date(trip.start_date! + "T00:00:00").getTime();
  const diff = target - now;
  const day = 86_400_000;
  const days = Math.round(diff / day);
  let label: string;
  if (diff < 0) label = copy.over;
  else if (days <= 0) label = copy.today;
  else if (days === 1) label = copy.tomorrow;
  else label = copy.inDays(days);

  const time = iso
    ? new Date(iso).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <div className="flex flex-wrap items-center gap-2 text-caps">
      <IconCalendar size={12} />
      <span>{label}</span>
      {time && (
        <>
          <span className="text-[var(--border-strong)]">·</span>
          <IconClock size={12} />
          <span className="text-mono">{time}</span>
        </>
      )}
    </div>
  );
}

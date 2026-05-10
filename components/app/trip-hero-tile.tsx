"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useAppLocale } from "@/components/app/app-locale-provider";
import type { Trip } from "@/lib/types";
import type { AppMember } from "@/app/api/app/trips/[tripId]/members/route";
import {
  IconArrowUpRight,
  IconCalendar,
  IconPin,
  IconStamp,
  IconUsers,
} from "@/components/app/icons";
import { cn } from "@/lib/utils";

export type HeroVariant = "conservative" | "balanced" | "expressive";
export type HeroMode = "pre" | "tminus" | "in" | "post";

const COPY = {
  en: {
    daysOut: (n: number) => `${n} day${n === 1 ? "" : "s"} to go`,
    overdue: "Trip ended",
    todayKickoff: "Trip starts today",
    tomorrowKickoff: "Trip starts tomorrow",
    dayOf: (d: number, total: number) => `Day ${d} of ${total}`,
    weekOut: (n: number) => `T-${n}d`,
    going: "going",
    plus: (n: number) => `+${n}`,
    publish: "Publish itinerary",
    openToday: "Open today",
    settle: "Settle expenses",
    invite: "Invite",
    map: "Open in Maps",
    line: "Open in LINE",
    untitled: "Untitled trip",
    datesTbd: "Dates to be decided",
  },
  "zh-TW": {
    daysOut: (n: number) => `還有 ${n} 天`,
    overdue: "旅程已結束",
    todayKickoff: "今天出發",
    tomorrowKickoff: "明天出發",
    dayOf: (d: number, total: number) => `第 ${d} / ${total} 天`,
    weekOut: (n: number) => `T-${n}d`,
    going: "一同出發",
    plus: (n: number) => `+${n}`,
    publish: "發布行程",
    openToday: "查看今日",
    settle: "結算費用",
    invite: "邀請旅伴",
    map: "在地圖開啟",
    line: "在 LINE 開啟",
    untitled: "未命名旅程",
    datesTbd: "日期待定",
  },
} as const;

interface HeroProps {
  variant?: HeroVariant;
  trip: Trip;
  members: AppMember[];
  groupName: string | null;
  lineDeepLink: string | null;
  tripId: string;
  onPrimary?: () => void;
}

export function TripHeroTile(props: HeroProps) {
  const variant = props.variant ?? "balanced";
  if (variant === "conservative") return <ConservativeHero {...props} />;
  if (variant === "expressive") return <ExpressiveHero {...props} />;
  return <BalancedHero {...props} />;
}

// ─── Shared helpers ─────────────────────────────────────────────────────────

function useMode(trip: Trip): { mode: HeroMode; daysToStart: number; dayIndex: number; tripLengthDays: number } {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  return useMemo(() => {
    const start = trip.start_date ? new Date(trip.start_date + "T00:00:00").getTime() : null;
    const end = trip.end_date ? new Date(trip.end_date + "T23:59:59").getTime() : null;
    const day = 86_400_000;
    if (!start) return { mode: "pre", daysToStart: 0, dayIndex: 0, tripLengthDays: 0 };
    const tripLengthDays = end && start ? Math.max(1, Math.round((end - start) / day) + 1) : 1;
    if (now < start) {
      const daysToStart = Math.max(0, Math.ceil((start - now) / day));
      return {
        mode: daysToStart <= 7 ? "tminus" : "pre",
        daysToStart,
        dayIndex: 0,
        tripLengthDays,
      };
    }
    if (end && now > end) {
      return { mode: "post", daysToStart: 0, dayIndex: tripLengthDays, tripLengthDays };
    }
    const dayIndex = Math.min(tripLengthDays, Math.floor((now - start) / day) + 1);
    return { mode: "in", daysToStart: 0, dayIndex, tripLengthDays };
  }, [trip.start_date, trip.end_date, now]);
}

function rosterSentence(members: AppMember[], copy: typeof COPY[keyof typeof COPY]): string {
  if (members.length === 0) return "";
  const names = members
    .map((m) => m.displayName?.trim())
    .filter((n): n is string => !!n);
  if (names.length === 0) return `${members.length} ${copy.going}`;
  if (names.length <= 3) return `${names.join(", ")} ${copy.going}`;
  return `${names.slice(0, 3).join(", ")}, ${copy.plus(names.length - 3)} ${copy.going}`;
}

function formatDateRange(trip: Trip, locale: "en" | "zh-TW"): string {
  if (!trip.start_date) return "—";
  const intl = locale === "zh-TW" ? "zh-TW" : "en-US";
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  const start = new Date(trip.start_date + "T00:00:00").toLocaleDateString(intl, opts);
  if (!trip.end_date) return start;
  const end = new Date(trip.end_date + "T00:00:00").toLocaleDateString(intl, {
    ...opts,
    year: "numeric",
  });
  return `${start} — ${end}`;
}

interface CountdownProps {
  mode: HeroMode;
  daysToStart: number;
  dayIndex: number;
  tripLengthDays: number;
  copy: typeof COPY[keyof typeof COPY];
  size?: "sm" | "md" | "lg";
}

function Countdown({ mode, daysToStart, dayIndex, tripLengthDays, copy, size = "md" }: CountdownProps) {
  const fontSize = size === "lg" ? "text-3xl" : size === "sm" ? "text-base" : "text-xl";
  let text: string;
  if (mode === "post") text = copy.overdue;
  else if (mode === "in") text = copy.dayOf(dayIndex, tripLengthDays);
  else if (daysToStart === 0) text = copy.todayKickoff;
  else if (daysToStart === 1) text = copy.tomorrowKickoff;
  else text = copy.daysOut(daysToStart);

  return (
    <span className={cn("text-mono font-semibold tracking-tight", fontSize)} aria-live="polite">
      {text}
    </span>
  );
}

function PrimaryCta({ mode, copy, onClick, href }: { mode: HeroMode; copy: typeof COPY[keyof typeof COPY]; onClick?: () => void; href?: string }) {
  const label = mode === "in" ? copy.openToday : mode === "post" ? copy.settle : copy.publish;
  const Element: "a" | "button" = href ? "a" : "button";
  return (
    <Element
      type={Element === "button" ? "button" : undefined}
      href={href}
      onClick={onClick}
      className="btn-tactile"
    >
      {label}
      <IconArrowUpRight size={16} />
    </Element>
  );
}

function SecondaryActions({
  tripId,
  trip,
  lineDeepLink,
  copy,
}: {
  tripId: string;
  trip: Trip;
  lineDeepLink: string | null;
  copy: typeof COPY[keyof typeof COPY];
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <Link
        href={`/app/trips/${tripId}/settings`}
        className="rounded-full border border-[var(--border-hairline)] bg-[var(--surface-raised)] px-3 py-1.5 font-medium text-[var(--text-secondary)] hover:border-[var(--border-strong)]"
      >
        {copy.invite}
      </Link>
      {trip.destination_google_maps_url && (
        <a
          href={trip.destination_google_maps_url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 rounded-full border border-[var(--border-hairline)] bg-[var(--surface-raised)] px-3 py-1.5 font-medium text-[var(--text-secondary)] hover:border-[var(--border-strong)]"
        >
          <IconPin size={12} />
          {copy.map}
        </a>
      )}
      {lineDeepLink && (
        <a
          href={lineDeepLink}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 rounded-full bg-[var(--accent-line)] px-3 py-1.5 font-semibold text-[var(--primary-foreground)] hover:opacity-95"
        >
          {copy.line}
        </a>
      )}
    </div>
  );
}

// ─── Variant: Conservative ──────────────────────────────────────────────────
// Calm. Editorial type, no mesh. The choice for organizers who want quiet.

function ConservativeHero({
  trip,
  members,
  lineDeepLink,
  tripId,
  onPrimary,
}: HeroProps) {
  const { locale } = useAppLocale();
  const copy = COPY[locale];
  const mode = useMode(trip);
  const dateRange = formatDateRange(trip, locale);
  const roster = rosterSentence(members, copy);

  return (
    <article className="surface-tile relative flex h-full flex-col gap-6 p-7 sm:p-9">
      <header className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <IconCalendar size={14} className="text-[var(--text-muted)]" />
        <p className="text-caps">{dateRange}</p>
      </header>
      <h1 className="text-display text-[clamp(2.4rem,5vw,3.6rem)] text-[var(--text-primary)]">
        {trip.destination_name ?? copy.untitled}
      </h1>
      <p className="text-sm text-[var(--text-secondary)]">{roster}</p>
      <div className="mt-auto flex flex-wrap items-end justify-between gap-4 pt-2">
        <Countdown {...mode} copy={copy} size="md" />
        <div className="flex items-center gap-3">
          <SecondaryActions tripId={tripId} trip={trip} lineDeepLink={lineDeepLink} copy={copy} />
          <PrimaryCta mode={mode.mode} copy={copy} onClick={onPrimary} />
        </div>
      </div>
    </article>
  );
}

// ─── Variant: Balanced ──────────────────────────────────────────────────────
// Default. Mesh + display type + roster + tactile CTA. The hero does work.

function BalancedHero({
  trip,
  members,
  lineDeepLink,
  tripId,
  onPrimary,
}: HeroProps) {
  const { locale } = useAppLocale();
  const copy = COPY[locale];
  const mode = useMode(trip);
  const dateRange = formatDateRange(trip, locale);
  const roster = rosterSentence(members, copy);

  return (
    <article className="surface-tile relative isolate flex h-full flex-col gap-7 overflow-hidden p-7 sm:p-9">
      <div className="hero-mesh hero-parallax" aria-hidden />
      <header className="relative flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <p className="text-caps">{dateRange}</p>
        {trip.destination_formatted_address && (
          <p className="text-xs text-[var(--text-muted)]">
            <IconPin size={12} className="mb-0.5 mr-1 inline-block" />
            {trip.destination_formatted_address}
          </p>
        )}
      </header>

      <div className="relative flex flex-col gap-3">
        <h1 className="text-display text-[clamp(2.8rem,6.4vw,4.5rem)] text-[var(--text-primary)]">
          {trip.destination_name ?? copy.untitled}
        </h1>
        <p className="text-sm text-[var(--text-secondary)]">
          <IconUsers size={14} className="mr-1.5 inline-block align-[-2px] text-[var(--text-muted)]" />
          {roster}
        </p>
      </div>

      <div className="relative mt-auto flex flex-wrap items-end justify-between gap-4">
        <Countdown {...mode} copy={copy} size="lg" />
        <div className="flex flex-wrap items-center gap-3">
          <SecondaryActions tripId={tripId} trip={trip} lineDeepLink={lineDeepLink} copy={copy} />
          <PrimaryCta mode={mode.mode} copy={copy} onClick={onPrimary} />
        </div>
      </div>
    </article>
  );
}

// ─── Variant: Expressive ────────────────────────────────────────────────────
// Loudest. Postmark stamp + parallax mesh + display destination set in two
// faces + member avatars. For the moment the group really wants to feel it.

function ExpressiveHero({
  trip,
  members,
  lineDeepLink,
  tripId,
  onPrimary,
}: HeroProps) {
  const { locale } = useAppLocale();
  const copy = COPY[locale];
  const mode = useMode(trip);
  const dateRange = formatDateRange(trip, locale);
  const roster = rosterSentence(members, copy);
  const avatars = members.slice(0, 5);
  const overflow = Math.max(0, members.length - avatars.length);

  return (
    <article className="surface-tile relative isolate flex h-full flex-col gap-7 overflow-hidden p-7 sm:p-10">
      <div className="hero-mesh hero-parallax" aria-hidden />
      <div
        aria-hidden
        className="absolute right-6 top-6 hidden text-[var(--accent-line)] opacity-70 sm:block"
      >
        <IconStamp size={88} strokeWidth={1.25} />
        <span className="hero-stamp absolute inset-0 flex items-center justify-center text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--accent-line)]">
          {trip.destination_name?.slice(0, 4) ?? "TRIP"}
        </span>
      </div>

      <header className="relative">
        <p className="text-caps">{dateRange}</p>
      </header>

      <div className="relative flex flex-col gap-4">
        <h1 className="text-display text-[clamp(3rem,7.5vw,5.4rem)] leading-[1] text-[var(--text-primary)]">
          {trip.destination_name ?? copy.untitled}
        </h1>
        {trip.title && trip.title !== trip.destination_name && (
          <p className="text-display text-xl italic text-[var(--text-muted)]">
            {trip.title}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3 text-sm text-[var(--text-secondary)]">
          {avatars.length > 0 && (
            <div className="flex -space-x-2">
              {avatars.map((m) => (
                <span
                  key={m.lineUserId}
                  className="inline-flex h-7 w-7 items-center justify-center overflow-hidden rounded-full border-2 border-[var(--surface-raised)] bg-[var(--surface-sunken)] text-[10px] font-semibold text-[var(--text-secondary)]"
                  title={m.displayName ?? ""}
                >
                  {(m.displayName ?? "?").slice(0, 1)}
                </span>
              ))}
              {overflow > 0 && (
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border-2 border-[var(--surface-raised)] bg-[var(--surface-sunken)] text-[10px] font-semibold text-[var(--text-muted)]">
                  +{overflow}
                </span>
              )}
            </div>
          )}
          <span>{roster}</span>
        </div>
      </div>

      <div className="relative mt-auto flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <Countdown {...mode} copy={copy} size="lg" />
          <span
            className="block h-[2px] w-12 rounded-full bg-[var(--accent-line)]"
            style={{ boxShadow: "var(--accent-line-glow)" }}
            aria-hidden
          />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <SecondaryActions tripId={tripId} trip={trip} lineDeepLink={lineDeepLink} copy={copy} />
          <PrimaryCta mode={mode.mode} copy={copy} onClick={onPrimary} />
        </div>
      </div>
    </article>
  );
}

export const HERO_VARIANTS: HeroVariant[] = ["conservative", "balanced", "expressive"];

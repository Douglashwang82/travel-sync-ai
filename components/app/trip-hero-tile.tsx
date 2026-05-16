"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAppLocale } from "@/components/app/app-locale-provider";
import { appFetchJson, AppApiFetchError } from "@/lib/app-client";
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
    inviteCta: "Invite trip member",
    openToday: "Open today",
    settle: "Settle expenses",
    map: "Open in Maps",
    line: "Open in LINE",
    untitled: "Untitled trip",
    datesTbd: "Dates to be decided",
    addDestination: "Add destination",
    addDeparture: "Add departure",
    departureFrom: "From",
    destinationTo: "To",
    addDates: "Add dates",
    save: "Save",
    cancel: "Cancel",
    saving: "Saving…",
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
    inviteCta: "邀請旅伴加入",
    openToday: "查看今日",
    settle: "結算費用",
    map: "在地圖開啟",
    line: "在 LINE 開啟",
    untitled: "未命名旅程",
    datesTbd: "日期待定",
    addDestination: "新增目的地",
    addDeparture: "新增出發地",
    departureFrom: "從",
    destinationTo: "前往",
    addDates: "新增日期",
    save: "儲存",
    cancel: "取消",
    saving: "儲存中…",
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
  onTripChange?: (trip: Trip) => void;
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

function PrimaryCta({
  mode,
  copy,
  tripId,
  onClick,
}: {
  mode: HeroMode;
  copy: typeof COPY[keyof typeof COPY];
  tripId: string;
  onClick?: () => void;
}) {
  if (mode === "in") {
    return (
      <button type="button" onClick={onClick} className="btn-tactile">
        {copy.openToday}
        <IconArrowUpRight size={16} />
      </button>
    );
  }
  if (mode === "post") {
    return (
      <button type="button" onClick={onClick} className="btn-tactile">
        {copy.settle}
        <IconArrowUpRight size={16} />
      </button>
    );
  }
  // Pre-trip and T-minus: the primary action is to bring more travellers in.
  return (
    <Link href={`/app/trips/${tripId}/settings`} className="btn-tactile">
      {copy.inviteCta}
      <IconArrowUpRight size={16} />
    </Link>
  );
}

function SecondaryActions({
  trip,
  lineDeepLink,
  copy,
}: {
  trip: Trip;
  lineDeepLink: string | null;
  copy: typeof COPY[keyof typeof COPY];
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
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

// ─── Editable trip details (date / destination / departure) ────────────────
// Any group member may edit these via PATCH /api/app/trips/[tripId].

interface TripDraft {
  destinationName: string;
  departureName: string;
  startDate: string;
  endDate: string;
}

function draftFromTrip(trip: Trip): TripDraft {
  return {
    destinationName: trip.destination_name ?? "",
    departureName: trip.departure_name ?? "",
    startDate: trip.start_date ?? "",
    endDate: trip.end_date ?? "",
  };
}

function useTripEditor(trip: Trip, tripId: string, onTripChange?: (t: Trip) => void) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<TripDraft>(() => draftFromTrip(trip));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastSyncedRef = useRef<Trip>(trip);

  // Keep the draft in sync with the trip prop while not actively editing.
  useEffect(() => {
    if (lastSyncedRef.current !== trip && !editing) {
      setDraft(draftFromTrip(trip));
      lastSyncedRef.current = trip;
    }
  }, [trip, editing]);

  const open = useCallback(() => {
    setDraft(draftFromTrip(trip));
    setError(null);
    setEditing(true);
  }, [trip]);

  const cancel = useCallback(() => {
    setDraft(draftFromTrip(trip));
    setError(null);
    setEditing(false);
  }, [trip]);

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    const payload: Record<string, unknown> = {};
    const trimmedDest = draft.destinationName.trim();
    const trimmedDep = draft.departureName.trim();
    if (trimmedDest !== (trip.destination_name ?? "")) {
      payload.destinationName = trimmedDest === "" ? null : trimmedDest;
    }
    if (trimmedDep !== (trip.departure_name ?? "")) {
      payload.departureName = trimmedDep === "" ? null : trimmedDep;
    }
    if ((draft.startDate || null) !== trip.start_date) {
      payload.startDate = draft.startDate || null;
    }
    if ((draft.endDate || null) !== trip.end_date) {
      payload.endDate = draft.endDate || null;
    }
    if (Object.keys(payload).length === 0) {
      setSaving(false);
      setEditing(false);
      return;
    }
    try {
      const res = await appFetchJson<{ trip: Trip }>(`/api/app/trips/${tripId}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      onTripChange?.(res.trip);
      setEditing(false);
    } catch (err) {
      setError(err instanceof AppApiFetchError ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, [draft, trip, tripId, onTripChange]);

  return { editing, draft, setDraft, saving, error, open, cancel, save };
}

type EditorState = ReturnType<typeof useTripEditor>;

function EditToggle({
  editor,
  copy,
}: {
  editor: EditorState;
  copy: typeof COPY[keyof typeof COPY];
}) {
  if (editor.editing) return null;
  return (
    <button
      type="button"
      onClick={editor.open}
      className="ml-auto rounded-full border border-[var(--border-hairline)] bg-[var(--surface-raised)] px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)] hover:border-[var(--accent-line)] hover:text-[var(--text-primary)]"
      aria-label={copy.save === "Save" ? "Edit trip details" : "編輯旅程"}
    >
      {copy.save === "Save" ? "Edit" : "編輯"}
    </button>
  );
}

function EditableDestination({
  trip,
  editor,
  copy,
  className,
}: {
  trip: Trip;
  editor: EditorState;
  copy: typeof COPY[keyof typeof COPY];
  className?: string;
}) {
  if (editor.editing) {
    return (
      <input
        type="text"
        value={editor.draft.destinationName}
        onChange={(e) =>
          editor.setDraft((d) => ({ ...d, destinationName: e.target.value }))
        }
        placeholder={copy.addDestination}
        aria-label={copy.addDestination}
        className={cn(
          "w-full max-w-full rounded-[var(--radius-input)] border border-[var(--border-hairline)] bg-[var(--surface-sunken)] px-3 py-2 text-display text-[var(--text-primary)] outline-none focus:border-[var(--accent-line)]",
          className
        )}
      />
    );
  }
  return (
    <h1 className={cn("text-display text-[var(--text-primary)]", className)}>
      {trip.destination_name ?? copy.untitled}
    </h1>
  );
}

function EditableDateRange({
  trip,
  editor,
  copy,
  locale,
}: {
  trip: Trip;
  editor: EditorState;
  copy: typeof COPY[keyof typeof COPY];
  locale: "en" | "zh-TW";
}) {
  if (editor.editing) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="date"
          value={editor.draft.startDate}
          onChange={(e) =>
            editor.setDraft((d) => ({ ...d, startDate: e.target.value }))
          }
          aria-label={copy.addDates}
          className="rounded-full border border-[var(--border-hairline)] bg-[var(--surface-raised)] px-3 py-1 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent-line)]"
        />
        <span className="text-xs text-[var(--text-muted)]">—</span>
        <input
          type="date"
          value={editor.draft.endDate}
          onChange={(e) =>
            editor.setDraft((d) => ({ ...d, endDate: e.target.value }))
          }
          aria-label={copy.addDates}
          className="rounded-full border border-[var(--border-hairline)] bg-[var(--surface-raised)] px-3 py-1 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent-line)]"
        />
      </div>
    );
  }
  const range = formatDateRange(trip, locale);
  return <p className="text-caps">{range === "—" ? copy.addDates : range}</p>;
}

function EditableDeparture({
  trip,
  editor,
  copy,
}: {
  trip: Trip;
  editor: EditorState;
  copy: typeof COPY[keyof typeof COPY];
}) {
  if (editor.editing) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-caps text-[var(--text-muted)]">
          {copy.departureFrom}
        </span>
        <input
          type="text"
          value={editor.draft.departureName}
          onChange={(e) =>
            editor.setDraft((d) => ({ ...d, departureName: e.target.value }))
          }
          placeholder={copy.addDeparture}
          aria-label={copy.addDeparture}
          className="min-w-0 flex-1 rounded-full border border-[var(--border-hairline)] bg-[var(--surface-raised)] px-3 py-1 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent-line)]"
        />
      </div>
    );
  }
  if (!trip.departure_name) return null;
  return (
    <p className="text-xs text-[var(--text-muted)]">
      <IconPin size={12} className="mb-0.5 mr-1 inline-block" />
      {copy.departureFrom} {trip.departure_name}
    </p>
  );
}

function EditorActions({
  editor,
  copy,
}: {
  editor: EditorState;
  copy: typeof COPY[keyof typeof COPY];
}) {
  return (
    <div className="flex items-center gap-2">
      {editor.error && (
        <span className="text-xs text-[var(--status-blocked)]">{editor.error}</span>
      )}
      <button
        type="button"
        onClick={editor.cancel}
        disabled={editor.saving}
        className="rounded-full border border-[var(--border-hairline)] bg-[var(--surface-raised)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:border-[var(--border-strong)] disabled:opacity-50"
      >
        {copy.cancel}
      </button>
      <button
        type="button"
        onClick={() => void editor.save()}
        disabled={editor.saving}
        className="btn-tactile"
      >
        {editor.saving ? copy.saving : copy.save}
      </button>
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
  onTripChange,
}: HeroProps) {
  const { locale } = useAppLocale();
  const copy = COPY[locale];
  const mode = useMode(trip);
  const roster = rosterSentence(members, copy);
  const editor = useTripEditor(trip, tripId, onTripChange);

  return (
    <article className="surface-tile relative flex h-full flex-col gap-6 p-7 sm:p-9">
      <header className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <IconCalendar size={14} className="text-[var(--text-muted)]" />
        <EditableDateRange trip={trip} editor={editor} copy={copy} locale={locale} />
        <EditToggle editor={editor} copy={copy} />
      </header>
      <EditableDestination
        trip={trip}
        editor={editor}
        copy={copy}
        className="text-[clamp(2.4rem,5vw,3.6rem)]"
      />
      <EditableDeparture trip={trip} editor={editor} copy={copy} />
      <p className="text-sm text-[var(--text-secondary)]">{roster}</p>
      <div className="mt-auto flex flex-wrap items-end justify-between gap-4 pt-2">
        <Countdown {...mode} copy={copy} size="md" />
        <div className="flex items-center gap-3">
          {editor.editing ? (
            <EditorActions editor={editor} copy={copy} />
          ) : (
            <>
              <SecondaryActions trip={trip} lineDeepLink={lineDeepLink} copy={copy} />
              <PrimaryCta mode={mode.mode} copy={copy} tripId={tripId} onClick={onPrimary} />
            </>
          )}
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
  onTripChange,
}: HeroProps) {
  const { locale } = useAppLocale();
  const copy = COPY[locale];
  const mode = useMode(trip);
  const roster = rosterSentence(members, copy);
  const editor = useTripEditor(trip, tripId, onTripChange);

  return (
    <article className="surface-tile relative isolate flex h-full flex-col gap-7 overflow-hidden p-7 sm:p-9">
      <header className="relative flex flex-wrap items-baseline gap-x-4 gap-y-2">
        <EditableDateRange trip={trip} editor={editor} copy={copy} locale={locale} />
        {!editor.editing && trip.destination_formatted_address && (
          <p className="text-xs text-[var(--text-muted)]">
            <IconPin size={12} className="mb-0.5 mr-1 inline-block" />
            {trip.destination_formatted_address}
          </p>
        )}
        <EditToggle editor={editor} copy={copy} />
      </header>

      <div className="relative flex flex-col gap-3">
        <EditableDestination
          trip={trip}
          editor={editor}
          copy={copy}
          className="text-[clamp(2.8rem,6.4vw,4.5rem)]"
        />
        <EditableDeparture trip={trip} editor={editor} copy={copy} />
        <p className="text-sm text-[var(--text-secondary)]">
          <IconUsers size={14} className="mr-1.5 inline-block align-[-2px] text-[var(--text-muted)]" />
          {roster}
        </p>
      </div>

      <div className="relative mt-auto flex flex-wrap items-end justify-between gap-4">
        <Countdown {...mode} copy={copy} size="lg" />
        <div className="flex flex-wrap items-center gap-3">
          {editor.editing ? (
            <EditorActions editor={editor} copy={copy} />
          ) : (
            <>
              <SecondaryActions trip={trip} lineDeepLink={lineDeepLink} copy={copy} />
              <PrimaryCta mode={mode.mode} copy={copy} tripId={tripId} onClick={onPrimary} />
            </>
          )}
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
  onTripChange,
}: HeroProps) {
  const { locale } = useAppLocale();
  const copy = COPY[locale];
  const mode = useMode(trip);
  const roster = rosterSentence(members, copy);
  const avatars = members.slice(0, 5);
  const overflow = Math.max(0, members.length - avatars.length);
  const editor = useTripEditor(trip, tripId, onTripChange);

  return (
    <article className="surface-tile relative isolate flex h-full flex-col gap-7 overflow-hidden p-7 sm:p-10">
      <div
        aria-hidden
        className="absolute right-6 top-6 hidden text-[var(--accent-line)] opacity-70 sm:block"
      >
        <IconStamp size={88} strokeWidth={1.25} />
        <span className="hero-stamp absolute inset-0 flex items-center justify-center text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--accent-line)]">
          {trip.destination_name?.slice(0, 4) ?? "TRIP"}
        </span>
      </div>

      <header className="relative flex flex-wrap items-baseline gap-x-4 gap-y-2">
        <EditableDateRange trip={trip} editor={editor} copy={copy} locale={locale} />
        <EditToggle editor={editor} copy={copy} />
      </header>

      <div className="relative flex flex-col gap-4">
        <EditableDestination
          trip={trip}
          editor={editor}
          copy={copy}
          className="text-[clamp(3rem,7.5vw,5.4rem)] leading-[1]"
        />
        <EditableDeparture trip={trip} editor={editor} copy={copy} />
        {!editor.editing && trip.title && trip.title !== trip.destination_name && (
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
          {editor.editing ? (
            <EditorActions editor={editor} copy={copy} />
          ) : (
            <>
              <SecondaryActions trip={trip} lineDeepLink={lineDeepLink} copy={copy} />
              <PrimaryCta mode={mode.mode} copy={copy} tripId={tripId} onClick={onPrimary} />
            </>
          )}
        </div>
      </div>
    </article>
  );
}

export const HERO_VARIANTS: HeroVariant[] = ["conservative", "balanced", "expressive"];

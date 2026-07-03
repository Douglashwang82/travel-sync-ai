'use client'

// ─────────────────────────────────────────────────────────────────────────────
// DatesScene — the "when" phase of the index-page survey pipeline, between
// picking a city and picking spots.
//
// A two-month range calendar sits beside a decision-support sidebar fed by
// lib/home-seasons.ts: a 12-month seasonality chart (click to jump), a month
// dossier (temps, rain days, crowd and price meters, festival windows) and a
// live read-out of the selected window (expected weather, rain risk, events
// caught, weekend days). Length presets re-shape an existing selection; the
// "pick for me" button scans the whole booking horizon for the best-scoring
// window. Trips are capped at MAX_TRIP_DAYS so the itinerary solver downstream
// always gets a feasible day count.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowRight,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CloudRain,
  Sparkles,
  Thermometer,
  Users,
  Wallet,
  X,
} from "lucide-react";
import type { HomeCity, HomeCountry } from "@/lib/home-survey";
import {
  expandHomeSeasonEvents,
  findHomeBestWindow,
  getHomeCityMonths,
  getHomeSeasonEvents,
  homeMonthScore,
  isoAddDays,
  isoDiffDays,
  isoMonth,
  isoToday,
  isoWeekday,
  rateHomeMonths,
  type HomeMonthRating,
  type HomeSeasonEventOccurrence,
} from "@/lib/home-seasons";
import { easeConfirm, springSnappy } from "@/components/motion/variants";

export const MAX_TRIP_DAYS = 8;
const MIN_LEAD_DAYS = 3;
const HORIZON_DAYS = 365;

// Fixed at module evaluation: the scene only ever mounts client-side after the
// visitor has picked a city, so there is no SSR mismatch to worry about.
const TODAY = isoToday();
const MIN_DATE = isoAddDays(TODAY, MIN_LEAD_DAYS);
const MAX_DATE = isoAddDays(TODAY, HORIZON_DAYS);

export interface HomeDateRange {
  /** ISO YYYY-MM-DD, inclusive. */
  start: string;
  end: string;
}

interface DatesSceneProps {
  country: HomeCountry;
  city: HomeCity;
  locale: "en" | "zh-TW";
  value: HomeDateRange | null;
  onConfirm: (range: HomeDateRange) => void;
  onBack: () => void;
}

const MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTHS_EN_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS_EN = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const WEEKDAYS_ZH = ["日", "一", "二", "三", "四", "五", "六"];

function monthKeyOf(iso: string): string {
  return iso.slice(0, 7);
}

function addMonths(key: string, n: number): string {
  const base = Number(key.slice(0, 4)) * 12 + (Number(key.slice(5, 7)) - 1) + n;
  const y = Math.floor(base / 12);
  const m = (base % 12) + 1;
  return `${y}-${String(m).padStart(2, "0")}`;
}

function monthLabel(key: string, zh: boolean): string {
  const y = Number(key.slice(0, 4));
  const m = Number(key.slice(5, 7));
  return zh ? `${y} 年 ${m} 月` : `${MONTHS_EN[m - 1]} ${y}`;
}

function fmtDay(iso: string, zh: boolean): string {
  const m = Number(iso.slice(5, 7));
  const d = Number(iso.slice(8, 10));
  return zh ? `${m}月${d}日` : `${MONTHS_EN_SHORT[m - 1]} ${d}`;
}

function daysInMonthOf(key: string): number {
  return new Date(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)), 0)).getUTCDate();
}

export default function DatesScene({ country, city, locale, value, onConfirm, onBack }: DatesSceneProps) {
  const zh = locale === "zh-TW";

  const [start, setStart] = useState<string | null>(value?.start ?? null);
  const [end, setEnd] = useState<string | null>(value?.end ?? null);
  const [hoverIso, setHoverIso] = useState<string | null>(null);
  const [viewKey, setViewKey] = useState(() => monthKeyOf(value?.start ?? MIN_DATE));
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 4500);
    return () => clearTimeout(timer);
  }, [notice]);

  const months = useMemo(() => getHomeCityMonths(country.code, city.name), [country.code, city.name]);
  const ratings = useMemo(() => rateHomeMonths(months), [months]);
  const scores = useMemo(() => months.map(homeMonthScore), [months]);
  const occurrences = useMemo(
    () => expandHomeSeasonEvents(getHomeSeasonEvents(country.code, city.name), TODAY, HORIZON_DAYS),
    [country.code, city.name],
  );

  const minViewKey = monthKeyOf(TODAY);
  const maxViewKey = monthKeyOf(MAX_DATE);
  const secondKey = addMonths(viewKey, 1);

  // While the end is still undecided, the hovered day paints a preview range
  // (clamped to the trip cap so the wash never promises an illegal window).
  const previewEnd =
    start && !end && hoverIso && hoverIso >= start
      ? hoverIso > isoAddDays(start, MAX_TRIP_DAYS - 1)
        ? isoAddDays(start, MAX_TRIP_DAYS - 1)
        : hoverIso
      : null;
  const paintEnd = end ?? previewEnd;

  const range = useMemo<HomeDateRange | null>(() => (start && end ? { start, end } : null), [start, end]);
  const rangeDays = range ? isoDiffDays(range.start, range.end) + 1 : null;

  const rangeStats = useMemo(() => {
    if (!range) return null;
    const dayCount = isoDiffDays(range.start, range.end) + 1;
    let hiSum = 0;
    let loSum = 0;
    let rainSum = 0;
    let maxCrowd = 0;
    let maxPrice = 0;
    let weekendDays = 0;
    for (let i = 0; i < dayCount; i++) {
      const iso = isoAddDays(range.start, i);
      const info = months[isoMonth(iso) - 1];
      hiSum += info.hiC;
      loSum += info.loC;
      rainSum += info.rainDays / daysInMonthOf(monthKeyOf(iso));
      maxCrowd = Math.max(maxCrowd, info.crowd);
      maxPrice = Math.max(maxPrice, info.price);
      const weekday = isoWeekday(iso);
      if (weekday === 0 || weekday === 6) weekendDays += 1;
    }
    return {
      dayCount,
      hi: Math.round(hiSum / dayCount),
      lo: Math.round(loSum / dayCount),
      rain: Math.round(rainSum),
      maxCrowd,
      maxPrice,
      weekendDays,
      events: occurrences.filter((o) => o.startIso <= range.end && o.endIso >= range.start),
    };
  }, [range, months, occurrences]);

  const clickDay = (iso: string) => {
    if (!start || end) {
      setStart(iso);
      setEnd(null);
      return;
    }
    if (iso < start) {
      setStart(iso);
      return;
    }
    const cap = isoAddDays(start, MAX_TRIP_DAYS - 1);
    if (iso > cap) {
      setEnd(cap);
      setNotice(zh ? `示範行程最長 ${MAX_TRIP_DAYS} 天，已自動縮短。` : `Demo trips cap at ${MAX_TRIP_DAYS} days — trimmed the end for you.`);
      return;
    }
    setEnd(iso);
  };

  const clearDates = () => {
    setStart(null);
    setEnd(null);
    setHoverIso(null);
  };

  const applyLength = (lengthDays: number) => {
    if (start) {
      const target = isoAddDays(start, lengthDays - 1);
      setEnd(target > MAX_DATE ? MAX_DATE : target);
      return;
    }
    smartPick(lengthDays);
  };

  const smartPick = (lengthDays?: number) => {
    const length = lengthDays ?? rangeDays ?? 5;
    const best = findHomeBestWindow(country.code, city.name, length, MIN_DATE, HORIZON_DAYS - MIN_LEAD_DAYS);
    setStart(best.start);
    setEnd(best.end);
    setViewKey(monthKeyOf(best.start));
    setNotice(
      zh
        ? `已挑出未來 12 個月中最理想的 ${length} 天時段。`
        : `Picked the best-scoring ${length}-day window in the next 12 months.`,
    );
  };

  const lengthOptions = [
    { days: 3, label: zh ? "週末 3 天" : "Weekend · 3d" },
    { days: 5, label: zh ? "小旅行 5 天" : "Getaway · 5d" },
    { days: 7, label: zh ? "整週 7 天" : "Full week · 7d" },
  ];

  const cityLabel = zh ? city.nameZh : city.name;
  const viewMonthInfo = months[Number(viewKey.slice(5, 7)) - 1];
  const viewMonthRating = ratings.get(viewMonthInfo.month) ?? "good";
  const monthEvents = useMemo(() => {
    const monthStart = `${viewKey}-01`;
    const monthEnd = `${viewKey}-${String(daysInMonthOf(viewKey)).padStart(2, "0")}`;
    const seen = new Set<string>();
    return occurrences.filter((o) => {
      if (o.startIso > monthEnd || o.endIso < monthStart || seen.has(o.event.id)) return false;
      seen.add(o.event.id);
      return true;
    });
  }, [viewKey, occurrences]);

  return (
    <div id="home-dates-scene" className="mx-auto w-full max-w-6xl px-5 sm:px-8">
      {/* ─── Toolbar: back + selection read-out ────────────────────────────── */}
      <motion.div
        id="home-dates-toolbar"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.38, ease: easeConfirm }}
        className="mb-4 flex flex-wrap items-center justify-between gap-3"
      >
        <button
          id="home-dates-back"
          type="button"
          onClick={onBack}
          className="inline-flex h-9 items-center gap-1 rounded-full border border-[var(--border-hairline)] bg-[var(--surface-raised)] px-3.5 text-[13px] font-semibold text-[var(--text-muted)] transition hover:text-[var(--text-primary)]"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
          {zh ? "重選城市" : "Change city"}
        </button>
        <div id="home-dates-readout" className="flex items-center gap-2">
          <p id="home-dates-readout-text" className="text-mono text-[13px] font-semibold text-[var(--text-muted)]">
            {range ? (
              <>
                <span id="home-dates-readout-range" className="text-[var(--accent-line)]">
                  {fmtDay(range.start, zh)} – {fmtDay(range.end, zh)}
                </span>
                {zh ? ` · ${rangeDays} 天` : ` · ${rangeDays} day${rangeDays === 1 ? "" : "s"}`}
              </>
            ) : start ? (
              zh ? "再點一天作為結束日" : "Now tap an end date"
            ) : (
              zh ? "點選出發日開始" : "Tap a start date"
            )}
          </p>
          {(start || end) && (
            <button
              id="home-dates-clear"
              type="button"
              onClick={clearDates}
              className="inline-flex h-7 items-center gap-1 rounded-full bg-[var(--text-primary)] px-2.5 text-[11.5px] font-bold text-[var(--surface-base)] transition hover:opacity-85"
            >
              <X className="h-3 w-3" aria-hidden />
              {zh ? "清除" : "Clear"}
            </button>
          )}
        </div>
      </motion.div>

      <div id="home-dates-layout" className="grid gap-5 lg:grid-cols-[1fr_330px]">
        {/* ─── Left: presets + calendar ───────────────────────────────────── */}
        <motion.div
          id="home-dates-main"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.38, ease: easeConfirm, delay: 0.08 }}
        >
          <div id="home-dates-presets" className="mb-3 flex flex-wrap items-center gap-1.5">
            <span id="home-dates-presets-label" className="mr-0.5 text-[11.5px] font-semibold text-[var(--text-faint)]">
              {zh ? "旅程長度" : "Trip length"}
            </span>
            {lengthOptions.map((option) => {
              const active = rangeDays === option.days;
              return (
                <button
                  key={option.days}
                  id={`home-dates-preset-${option.days}`}
                  type="button"
                  onClick={() => applyLength(option.days)}
                  aria-pressed={active}
                  className={`inline-flex h-8 items-center rounded-full px-3 text-[12.5px] font-semibold transition ${
                    active
                      ? "bg-[var(--text-primary)] text-[var(--surface-base)]"
                      : "border border-[var(--border-strong)] text-[var(--text-muted)] hover:border-[var(--text-primary)] hover:text-[var(--text-primary)]"
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
            <button
              id="home-dates-smart-pick"
              type="button"
              onClick={() => smartPick()}
              className="inline-flex h-8 items-center gap-1.5 rounded-full border border-dashed border-[var(--border-strong)] px-3 text-[12.5px] font-semibold text-[var(--text-muted)] transition hover:border-solid hover:border-[var(--accent-line)] hover:text-[var(--accent-line)]"
            >
              <Sparkles className="h-3.5 w-3.5" aria-hidden />
              {zh ? "幫我挑最佳時段" : "Pick the best window for me"}
            </button>
          </div>

          <div
            id="home-dates-calendar"
            className="surface-glass rounded-[1.4rem] border border-[var(--border-hairline)] p-4 shadow-[var(--shadow-raise)] sm:p-5"
            onMouseLeave={() => setHoverIso(null)}
          >
            <div id="home-dates-calendar-head" className="mb-3 flex items-center justify-between">
              <button
                id="home-dates-nav-prev"
                type="button"
                onClick={() => setViewKey((k) => addMonths(k, -1))}
                disabled={viewKey <= minViewKey}
                aria-label={zh ? "上一個月" : "Previous month"}
                className="grid h-8 w-8 place-items-center rounded-full border border-[var(--border-hairline)] text-[var(--text-muted)] transition hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-35"
              >
                <ChevronLeft className="h-4 w-4" aria-hidden />
              </button>
              <div id="home-dates-calendar-titles" className="flex flex-1 items-center justify-around">
                <h3 id="home-dates-month-title-1" className="text-[14px] font-bold tracking-wide">{monthLabel(viewKey, zh)}</h3>
                <h3 id="home-dates-month-title-2" className="hidden text-[14px] font-bold tracking-wide md:block">{monthLabel(secondKey, zh)}</h3>
              </div>
              <button
                id="home-dates-nav-next"
                type="button"
                onClick={() => setViewKey((k) => addMonths(k, 1))}
                disabled={secondKey >= maxViewKey}
                aria-label={zh ? "下一個月" : "Next month"}
                className="grid h-8 w-8 place-items-center rounded-full border border-[var(--border-hairline)] text-[var(--text-muted)] transition hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-35"
              >
                <ChevronRight className="h-4 w-4" aria-hidden />
              </button>
            </div>

            <div id="home-dates-grids" className="grid gap-6 md:grid-cols-2">
              <MonthGrid
                monthKey={viewKey}
                zh={zh}
                start={start}
                paintEnd={paintEnd}
                previewing={!!previewEnd}
                onDayClick={clickDay}
                onDayHover={setHoverIso}
                occurrences={occurrences}
              />
              <div id="home-dates-grid-2-wrap" className="hidden md:block">
                <MonthGrid
                  monthKey={secondKey}
                  zh={zh}
                  start={start}
                  paintEnd={paintEnd}
                  previewing={!!previewEnd}
                  onDayClick={clickDay}
                  onDayHover={setHoverIso}
                  occurrences={occurrences}
                />
              </div>
            </div>

            <div id="home-dates-legend" className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[var(--border-hairline)] pt-3 text-[11px] font-semibold text-[var(--text-faint)]">
              <span id="home-dates-legend-event" className="inline-flex items-center gap-1.5">
                <span aria-hidden className="h-1 w-1 rounded-full bg-[var(--text-muted)]" />
                {zh ? "節慶或活動" : "Festival or event"}
              </span>
              <span id="home-dates-legend-cap" className="inline-flex items-center gap-1.5">
                <CalendarDays className="h-3 w-3" aria-hidden />
                {zh ? `最長 ${MAX_TRIP_DAYS} 天` : `Up to ${MAX_TRIP_DAYS} days`}
              </span>
            </div>
          </div>

          <AnimatePresence>
            {notice && (
              <motion.p
                id="home-dates-notice"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={springSnappy}
                className="mt-3 text-center text-[12.5px] font-semibold text-[var(--text-muted)]"
              >
                {notice}
              </motion.p>
            )}
          </AnimatePresence>
        </motion.div>

        {/* ─── Right: seasonality intelligence ────────────────────────────── */}
        <motion.aside
          id="home-dates-sidebar"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.38, ease: easeConfirm, delay: 0.16 }}
          className="flex flex-col gap-4"
        >
          {/* 12-month seasonality chart */}
          <div id="home-dates-seasonality" className="surface-glass rounded-[1.4rem] border border-[var(--border-hairline)] p-4 shadow-[var(--shadow-raise)]">
            <div id="home-dates-seasonality-head" className="mb-3 flex items-baseline justify-between">
              <h3 id="home-dates-seasonality-title" className="text-[13px] font-bold uppercase tracking-[0.1em]">
                {zh ? `${cityLabel}的最佳時節` : `When to visit ${cityLabel}`}
              </h3>
            </div>
            <div id="home-dates-seasonality-bars" className="flex h-16 items-end gap-1">
              {months.map((info, i) => {
                const minScore = Math.min(...scores);
                const maxScore = Math.max(...scores);
                const pct = 22 + ((scores[i] - minScore) / Math.max(1, maxScore - minScore)) * 78;
                const rating = ratings.get(info.month) ?? "good";
                const isViewed = Number(viewKey.slice(5, 7)) === info.month;
                const currentMonth = Number(TODAY.slice(5, 7));
                const year = info.month >= currentMonth ? Number(TODAY.slice(0, 4)) : Number(TODAY.slice(0, 4)) + 1;
                return (
                  <button
                    key={info.month}
                    id={`home-dates-season-bar-${info.month}`}
                    type="button"
                    onClick={() => setViewKey(`${year}-${String(info.month).padStart(2, "0")}`)}
                    title={`${zh ? info.noteZh : info.note}`}
                    aria-label={zh ? `跳到 ${info.month} 月` : `Jump to ${MONTHS_EN[info.month - 1]}`}
                    className="group flex h-full flex-1 flex-col items-center justify-end gap-1"
                  >
                    <span
                      aria-hidden
                      style={{ height: `${pct}%` }}
                      className={`w-full rounded-sm transition-colors ${
                        isViewed
                          ? "bg-[var(--text-primary)]"
                          : rating === "best"
                            ? "bg-[var(--accent-line)]"
                            : "bg-[var(--border-strong)] group-hover:bg-[var(--text-muted)]"
                      }`}
                    />
                    <span aria-hidden className={`text-[9.5px] font-bold ${isViewed ? "text-[var(--text-primary)]" : "text-[var(--text-faint)]"}`}>
                      {info.month}
                    </span>
                  </button>
                );
              })}
            </div>
            <p id="home-dates-seasonality-hint" className="mt-2 text-[11px] font-semibold text-[var(--text-faint)]">
              <span aria-hidden className="mr-1 inline-block h-2 w-2 rounded-sm bg-[var(--accent-line)] align-middle" />
              {zh ? "綠色為評分最高的月份，點擊跳轉。" : "Green = top-scoring months. Tap a bar to jump."}
            </p>
          </div>

          {/* Month dossier */}
          <div id="home-dates-month-detail" className="surface-glass rounded-[1.4rem] border border-[var(--border-hairline)] p-4 shadow-[var(--shadow-raise)]">
            <div id="home-dates-month-detail-head" className="mb-3 flex items-center justify-between gap-2">
              <h3 id="home-dates-month-detail-title" className="text-[14px] font-bold">{monthLabel(viewKey, zh)}</h3>
              <RatingBadge id="home-dates-month-rating" rating={viewMonthRating} zh={zh} />
            </div>
            <dl id="home-dates-month-facts" className="grid grid-cols-2 gap-x-3 gap-y-2.5">
              <MonthFact
                id="home-dates-fact-temp"
                icon={Thermometer}
                label={zh ? "日高 / 夜低" : "High / low"}
                value={`${viewMonthInfo.hiC}° / ${viewMonthInfo.loC}°C`}
              />
              <MonthFact
                id="home-dates-fact-rain"
                icon={CloudRain}
                label={zh ? "降雨天數" : "Rain days"}
                value={zh ? `約 ${viewMonthInfo.rainDays} 天` : `~${viewMonthInfo.rainDays} / month`}
              />
              <MonthFact id="home-dates-fact-crowd" icon={Users} label={zh ? "人潮" : "Crowds"} meter={viewMonthInfo.crowd} />
              <MonthFact id="home-dates-fact-price" icon={Wallet} label={zh ? "價格" : "Prices"} meter={viewMonthInfo.price} />
            </dl>
            <p id="home-dates-month-note" className="mt-3 text-[12.5px] leading-relaxed text-[var(--text-muted)]">
              {zh ? viewMonthInfo.noteZh : viewMonthInfo.note}
            </p>
            {monthEvents.length > 0 && (
              <div id="home-dates-month-events" className="mt-3 flex flex-wrap gap-1.5">
                {monthEvents.map((o) => (
                  <span
                    key={o.event.id}
                    id={`home-dates-month-event-${o.event.id}`}
                    title={`${fmtDay(o.startIso, zh)} – ${fmtDay(o.endIso, zh)}`}
                    className="inline-flex h-6 items-center gap-1 rounded-full border border-[var(--border-hairline)] bg-[var(--surface-raised)] px-2 text-[11px] font-semibold text-[var(--text-muted)]"
                  >
                    <span aria-hidden>{o.event.emoji}</span>
                    {zh ? o.event.nameZh : o.event.name}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Selected-window read-out */}
          <AnimatePresence>
            {rangeStats && range && (
              <motion.div
                id="home-dates-range-card"
                initial={{ opacity: 0, y: 10, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.98 }}
                transition={{ duration: 0.3, ease: easeConfirm }}
                className="rounded-[1.4rem] border border-[var(--accent-line)]/45 bg-[var(--accent-line-soft)] p-4"
              >
                <h3 id="home-dates-range-title" className="text-[13px] font-bold uppercase tracking-[0.1em] text-[var(--accent-line)]">
                  {zh ? "你的旅程" : "Your window"}
                </h3>
                <p id="home-dates-range-dates" className="mt-1.5 text-[15px] font-bold">
                  {fmtDay(range.start, zh)} – {fmtDay(range.end, zh)}
                  <span id="home-dates-range-days" className="ml-2 text-[12.5px] font-semibold text-[var(--text-muted)]">
                    {zh
                      ? `${rangeStats.dayCount} 天 · 含 ${rangeStats.weekendDays} 個週末日`
                      : `${rangeStats.dayCount} days · ${rangeStats.weekendDays} weekend day${rangeStats.weekendDays === 1 ? "" : "s"}`}
                  </span>
                </p>
                <ul id="home-dates-range-facts" className="mt-2.5 space-y-1.5 text-[12.5px] font-medium text-[var(--text-muted)]">
                  <li id="home-dates-range-weather" className="flex items-center gap-2">
                    <Thermometer className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    {zh
                      ? `預期氣溫約 ${rangeStats.lo}–${rangeStats.hi}°C`
                      : `Expect roughly ${rangeStats.lo}–${rangeStats.hi}°C`}
                  </li>
                  <li id="home-dates-range-rain" className="flex items-center gap-2">
                    <CloudRain className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    {zh
                      ? `降雨風險：約 ${rangeStats.rain} / ${rangeStats.dayCount} 天`
                      : `Rain risk: ~${rangeStats.rain} of ${rangeStats.dayCount} days`}
                  </li>
                  <li id="home-dates-range-crowd" className="flex items-center gap-2">
                    <Users className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    {zh
                      ? `人潮 ${rangeStats.maxCrowd}/5 · 價格 ${rangeStats.maxPrice}/5`
                      : `Crowds ${rangeStats.maxCrowd}/5 · prices ${rangeStats.maxPrice}/5`}
                  </li>
                </ul>
                {rangeStats.events.length > 0 && (
                  <div id="home-dates-range-events" className="mt-2.5 flex flex-wrap gap-1.5">
                    {rangeStats.events.map((o) => (
                      <span
                        key={`range-${o.event.id}-${o.startIso}`}
                        id={`home-dates-range-event-${o.event.id}`}
                        className="inline-flex h-6 items-center gap-1 rounded-full bg-[var(--surface-base)]/70 px-2 text-[11px] font-semibold text-[var(--text-primary)]"
                      >
                        <span aria-hidden>{o.event.emoji}</span>
                        {zh ? o.event.nameZh : o.event.name}
                      </span>
                    ))}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </motion.aside>
      </div>

      {/* ─── Confirm dock ──────────────────────────────────────────────────── */}
      <div id="home-dates-dock-wrap" className="pointer-events-none sticky bottom-5 z-20 mt-6 flex justify-center">
        <motion.div
          id="home-dates-dock"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: easeConfirm, delay: 0.22 }}
          className="surface-glass pointer-events-auto flex items-center gap-4 rounded-full border border-[var(--border-hairline)] py-2 pl-5 pr-2 shadow-[var(--shadow-deep)]"
        >
          <p id="home-dates-dock-hint" className="text-[13px] font-medium text-[var(--text-muted)]">
            {range
              ? zh ? "日期看起來不錯！" : "Those dates look good."
              : zh ? "先選好出發與回程日" : "Pick your dates first"}
          </p>
          <button
            id="home-dates-submit"
            type="button"
            disabled={!range}
            onClick={() => range && onConfirm(range)}
            className="btn-tactile h-11 rounded-full px-5 text-[14px] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
          >
            {zh ? "下一步：挑景點" : "Continue to spots"}
            <ArrowRight className="h-4 w-4" aria-hidden />
          </button>
        </motion.div>
      </div>
    </div>
  );
}

// ─── Pieces ──────────────────────────────────────────────────────────────────

interface MonthGridProps {
  monthKey: string;
  zh: boolean;
  start: string | null;
  paintEnd: string | null;
  /** True while the end of the wash is a hover preview, not a committed end. */
  previewing: boolean;
  onDayClick: (iso: string) => void;
  onDayHover: (iso: string | null) => void;
  occurrences: HomeSeasonEventOccurrence[];
}

function MonthGrid({ monthKey, zh, start, paintEnd, previewing, onDayClick, onDayHover, occurrences }: MonthGridProps) {
  const year = Number(monthKey.slice(0, 4));
  const month = Number(monthKey.slice(5, 7));
  const dayCount = daysInMonthOf(monthKey);
  const leadingBlanks = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const weekdays = zh ? WEEKDAYS_ZH : WEEKDAYS_EN;

  return (
    <div id={`home-dates-grid-${monthKey}`}>
      <div id={`home-dates-weekdays-${monthKey}`} className="mb-1 grid grid-cols-7">
        {weekdays.map((label, i) => (
          <span
            key={label}
            id={`home-dates-weekday-${monthKey}-${i}`}
            aria-hidden
            className={`grid h-7 place-items-center text-[10.5px] font-bold uppercase ${i === 0 || i === 6 ? "text-[var(--text-faint)]" : "text-[var(--text-muted)]"}`}
          >
            {label}
          </span>
        ))}
      </div>
      <div id={`home-dates-days-${monthKey}`} className="grid grid-cols-7 gap-y-0.5">
        {Array.from({ length: leadingBlanks }, (_, i) => (
          <span key={`blank-${i}`} id={`home-dates-blank-${monthKey}-${i}`} aria-hidden />
        ))}
        {Array.from({ length: dayCount }, (_, i) => {
          const iso = `${monthKey}-${String(i + 1).padStart(2, "0")}`;
          const disabled = iso < MIN_DATE || iso > MAX_DATE;
          const isStart = iso === start;
          const isEnd = paintEnd != null && iso === paintEnd && start != null;
          const inRange = start != null && paintEnd != null && iso > start && iso < paintEnd;
          const isToday = iso === TODAY;
          const hasEvent = occurrences.some((o) => o.startIso <= iso && o.endIso >= iso);
          return (
            <button
              key={iso}
              id={`home-dates-day-${iso}`}
              type="button"
              disabled={disabled}
              onClick={() => onDayClick(iso)}
              onMouseEnter={() => !disabled && onDayHover(iso)}
              onFocus={() => !disabled && onDayHover(iso)}
              aria-label={iso}
              aria-pressed={isStart || (isEnd && !previewing)}
              className={`relative grid h-10 place-items-center rounded-lg text-[13px] font-semibold transition-colors ${
                disabled
                  ? "cursor-default text-[var(--text-faint)] opacity-45"
                  : isStart || (isEnd && !previewing)
                    ? "bg-[var(--accent-line)] text-white"
                    : isEnd || inRange
                      ? "bg-[var(--accent-line-soft)] text-[var(--text-primary)]"
                      : "text-[var(--text-primary)] hover:bg-[var(--surface-raised)]"
              } ${isToday && !isStart ? "ring-1 ring-inset ring-[var(--border-strong)]" : ""}`}
            >
              {i + 1}
              {hasEvent && (
                <span
                  aria-hidden
                  className={`absolute bottom-1 h-1 w-1 rounded-full ${isStart || (isEnd && !previewing) ? "bg-white/85" : "bg-[var(--text-muted)]"}`}
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function RatingBadge({ id, rating, zh }: { id: string; rating: HomeMonthRating; zh: boolean }) {
  const label =
    rating === "best" ? (zh ? "最佳時節" : "Best time") : rating === "good" ? (zh ? "適合前往" : "Good pick") : zh ? "有取捨" : "Trade-offs";
  return (
    <span
      id={id}
      className={`inline-flex h-6 shrink-0 items-center rounded-full px-2.5 text-[11px] font-bold ${
        rating === "best"
          ? "bg-[var(--accent-line-soft)] text-[var(--accent-line)]"
          : rating === "good"
            ? "bg-[var(--surface-raised)] text-[var(--text-primary)]"
            : "bg-[var(--surface-raised)] text-[var(--text-muted)]"
      }`}
    >
      {label}
    </span>
  );
}

function MonthFact({
  id,
  icon: Icon,
  label,
  value,
  meter,
}: {
  id: string;
  icon: typeof Thermometer;
  label: string;
  value?: string;
  meter?: number;
}) {
  return (
    <div id={id} className="flex items-start gap-2">
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" aria-hidden />
      <div id={`${id}-body`} className="min-w-0">
        <dt id={`${id}-label`} className="text-[10.5px] font-bold uppercase tracking-wide text-[var(--text-faint)]">{label}</dt>
        {meter != null ? (
          <dd id={`${id}-meter`} className="mt-1 flex items-center gap-0.5">
            {[1, 2, 3, 4, 5].map((step) => (
              <span
                key={step}
                aria-hidden
                className={`h-1.5 w-3 rounded-full ${step <= meter ? "bg-[var(--text-primary)]" : "bg-[var(--border-strong)]"}`}
              />
            ))}
            <span className="sr-only">{`${meter}/5`}</span>
          </dd>
        ) : (
          <dd id={`${id}-value`} className="mt-0.5 text-[13px] font-semibold text-[var(--text-primary)]">{value}</dd>
        )}
      </div>
    </div>
  );
}

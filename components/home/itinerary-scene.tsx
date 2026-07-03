'use client'

// ─────────────────────────────────────────────────────────────────────────────
// ItineraryScene — phase 4 of the index-page survey pipeline.
//
// "Field Journal" layout (claude.ai/design project "Itinerary showing page",
// option 1a): an editorial print-style page. A ruled masthead and photo strip
// up top, then the full timeline visible at once — serif day headings over a
// `time | detail | cost` grid with travel legs between stops — and a bordered
// sidebar holding the live map (Google map when a browser key is configured,
// animated SVG otherwise), the per-day budget and a social feed pulled from
// the trip's Instagram-style POIs. Days auto-cycle on the map; hovering a day
// section or using the sidebar day index focuses it. Colors ride the site's
// CSS tokens so the editorial look survives dark mode.
// ─────────────────────────────────────────────────────────────────────────────

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Instrument_Serif } from "next/font/google";
import { motion } from "motion/react";
import { APIProvider, Map as GoogleMap, Marker, useMap, useMapsLibrary } from "@vis.gl/react-google-maps";
import { ArrowRight, RotateCcw } from "lucide-react";
import { getHomePoi, type HomeCountry, type HomeItinerary, type HomeItineraryDay, type HomeItineraryStop } from "@/lib/home-survey";
import { fadeUp, staggerContainer } from "@/components/motion/variants";

const DAY_COLORS = ["#00b900", "#1fb6c9", "#7c5cff", "#ff5d5d", "#e08c00", "#d62976"];

const MAPS_BROWSER_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_API_KEY ?? "";

const editorialSerif = Instrument_Serif({ weight: "400", subsets: ["latin"], variable: "--font-editorial", display: "swap" });

/** Editorial display face with a CJK serif fallback for zh-TW. */
const SERIF = { fontFamily: "var(--font-editorial), 'Noto Serif TC', Georgia, serif" } as const;

interface ItinerarySceneProps {
  itinerary: HomeItinerary;
  country: HomeCountry;
  locale: "en" | "zh-TW";
  onRestart: () => void;
}

export default function ItineraryScene({ itinerary, country, locale, onRestart }: ItinerarySceneProps) {
  const zh = locale === "zh-TW";
  const [activeDay, setActiveDay] = useState(1);
  const pauseUntilRef = useRef(0);

  // Auto-cycle the focused day; manual focus pauses the tour briefly.
  useEffect(() => {
    if (itinerary.days.length <= 1) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(() => {
      if (Date.now() < pauseUntilRef.current || document.hidden) return;
      setActiveDay((d) => (d % itinerary.days.length) + 1);
    }, 4500);
    return () => window.clearInterval(id);
  }, [itinerary.days.length]);

  const focusDay = (day: number) => {
    // eslint-disable-next-line react-hooks/purity -- event handler only; pauses the auto-tour relative to the click instant
    pauseUntilRef.current = Date.now() + 12_000;
    setActiveDay(day);
  };

  const dateRange = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(zh ? "zh-TW" : "en-US", { month: "short", day: "numeric" });
    const first = new Date(`${itinerary.days[0]?.date}T00:00:00`);
    const last = new Date(`${itinerary.days[itinerary.days.length - 1]?.date}T00:00:00`);
    return `${fmt.format(first)} – ${fmt.format(last)}`;
  }, [itinerary.days, zh]);

  // Header photo strip: three stops spread across the trip.
  const heroStops = useMemo(() => {
    const all = itinerary.days.flatMap((d) => d.stops);
    if (all.length <= 3) return all;
    return [all[0], all[Math.floor(all.length / 2)], all[all.length - 1]];
  }, [itinerary.days]);

  // "From the feed": the trip's Instagram-styled POIs.
  const feedPois = useMemo(() => {
    const seen = new Set<string>();
    return itinerary.days
      .flatMap((d) => d.stops)
      .map((s) => getHomePoi(s.poiId))
      .filter((p) => {
        if (!p || p.media !== "insta" || seen.has(p.id)) return false;
        seen.add(p.id);
        return true;
      })
      .slice(0, 2);
  }, [itinerary.days]);

  return (
    <div id="home-itinerary-scene" className={`mx-auto w-full max-w-6xl px-5 pb-24 sm:px-8 ${editorialSerif.variable}`}>
      {/* ─── Masthead: ruled meta line, summary, photo strip ──────────────── */}
      <motion.header id="home-itinerary-header" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}>
        <div
          id="home-itinerary-rule"
          className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-[var(--text-primary)] pb-3 text-[11px] font-semibold uppercase tracking-[0.14em]"
        >
          <span id="home-itinerary-rule-no">{zh ? "行程紀錄 Nº 01" : "Itinerary Nº 01"}</span>
          <span id="home-itinerary-rule-meta">
            {dateRange} · {itinerary.days.length} {zh ? "天" : itinerary.days.length === 1 ? "day" : "days"} ·{" "}
            {zh ? country.nameZh : country.name} {country.flag}
          </span>
        </div>
        <p id="home-itinerary-summary" className="mt-5 max-w-[580px] text-[15px] leading-7 text-[var(--text-muted)]">
          {itinerary.summary}
        </p>

        <div id="home-itinerary-photo-strip" className="mt-7 flex h-[180px] gap-2.5 sm:h-[220px]">
          {heroStops.map((stop, i) => (
            <PhotoTile key={stop.poiId} stop={stop} zh={zh} wide={i === 0} hiddenOnMobile={i === 2} />
          ))}
        </div>
      </motion.header>

      {/* ─── Body: full timeline + bordered sidebar ───────────────────────── */}
      <div id="home-itinerary-body" className="mt-10 grid items-start gap-10 lg:grid-cols-[1fr_330px] xl:gap-12">
        <motion.div id="home-itinerary-days" variants={staggerContainer} initial="hidden" animate="show">
          {itinerary.days.map((day) => (
            <DaySection key={day.dayNumber} day={day} zh={zh} active={activeDay === day.dayNumber} onFocus={() => focusDay(day.dayNumber)} />
          ))}
        </motion.div>

        <motion.aside
          id="home-itinerary-sidebar"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="flex flex-col gap-6 lg:sticky lg:top-20"
        >
          {/* Map box */}
          <div id="home-itinerary-map-box" className="rounded-sm border border-[var(--text-primary)] p-4">
            <p id="home-itinerary-map-label" className="mb-3 text-[11px] font-bold uppercase tracking-[0.14em]">
              {zh ? `地圖 — ${country.nameZh}` : `Map — ${country.name}`}
            </p>
            <div id="home-itinerary-map-frame" className="relative h-[260px] overflow-hidden rounded-sm">
              {MAPS_BROWSER_KEY ? (
                <GoogleItineraryMap days={itinerary.days} activeDay={activeDay} />
              ) : (
                <SvgItineraryMap days={itinerary.days} activeDay={activeDay} onSelectDay={focusDay} />
              )}
            </div>
            <div id="home-itinerary-day-index" className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
              {itinerary.days.map((day) => {
                const active = activeDay === day.dayNumber;
                return (
                  <button
                    key={day.dayNumber}
                    id={`home-itinerary-day-chip-${day.dayNumber}`}
                    type="button"
                    onClick={() => focusDay(day.dayNumber)}
                    aria-pressed={active}
                    className={`text-[11px] font-bold uppercase tracking-[0.12em] transition-colors ${
                      active
                        ? "text-[var(--text-primary)] underline underline-offset-4"
                        : "text-[var(--text-faint)] hover:text-[var(--text-muted)]"
                    }`}
                  >
                    {zh ? `第 ${day.dayNumber} 天` : `Day ${day.dayNumber}`}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Budget box */}
          <div id="home-itinerary-budget-box" className="rounded-sm border border-[var(--text-primary)] p-4">
            <p id="home-itinerary-budget-label" className="mb-3 text-[11px] font-bold uppercase tracking-[0.14em]">
              {zh ? "旅費預估" : "Trip budget"}
            </p>
            <div id="home-itinerary-budget-rows" className="flex flex-col gap-2 text-[13px]">
              {itinerary.days.map((day) => (
                <div key={day.dayNumber} id={`home-itinerary-budget-day-${day.dayNumber}`} className="flex justify-between gap-3">
                  <span className="text-[var(--text-muted)]">
                    {zh ? `第 ${day.dayNumber} 天` : `Day ${day.dayNumber}`}
                    <span className="text-[var(--text-faint)]"> · {day.stops.length} {zh ? "站" : day.stops.length === 1 ? "stop" : "stops"}</span>
                  </span>
                  <span className="text-mono font-semibold">${day.dayCostUsd.toLocaleString("en-US")}</span>
                </div>
              ))}
              <div id="home-itinerary-budget-total" className="mt-1 flex justify-between gap-3 border-t border-[var(--text-primary)] pt-2 text-[14px]">
                <span className="font-semibold">{zh ? "預估總計" : "Total est."}</span>
                <span className="text-mono font-bold">
                  {itinerary.totalCostLocal}
                  {country.currency.code !== "USD" && (
                    <span className="ml-1.5 font-medium text-[var(--text-muted)]">≈ ${itinerary.totalCostUsd.toLocaleString("en-US")}</span>
                  )}
                </span>
              </div>
            </div>
          </div>

          {/* From the feed */}
          {feedPois.length > 0 && (
            <div id="home-itinerary-feed">
              <p id="home-itinerary-feed-label" className="mb-3 text-[11px] font-bold uppercase tracking-[0.14em]">
                {zh ? "旅人動態" : "From the feed"}
              </p>
              <div id="home-itinerary-feed-rows" className="flex flex-col gap-2.5">
                {feedPois.map((poi) => (
                  <div
                    key={poi!.id}
                    id={`home-itinerary-feed-${poi!.id}`}
                    className="flex items-center gap-2.5 rounded-sm border border-[var(--border-hairline)] p-2.5"
                  >
                    <FeedThumb poiId={poi!.id} emoji={poi!.emoji} hue={poi!.hue} />
                    <p className="min-w-0 text-[12px] leading-normal">
                      <span className="font-bold">@{poi!.handle}</span>
                      <span className="text-[var(--text-faint)]"> · IG</span>
                      <span className="line-clamp-2 block text-[var(--text-muted)]">“{zh ? poi!.blurbZh : poi!.blurb}”</span>
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </motion.aside>
      </div>

      <motion.div
        id="home-itinerary-ctas"
        variants={fadeUp}
        initial="hidden"
        animate="show"
        className="mt-12 flex flex-wrap items-center justify-center gap-3"
      >
        <Link id="home-itinerary-cta-app" href="/app" className="btn-tactile h-12 rounded-full px-6 text-[14.5px]">
          {zh ? "在 TravelSync 開始規劃" : "Plan it for real in TravelSync"}
          <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
        <button
          id="home-itinerary-cta-restart"
          type="button"
          onClick={onRestart}
          className="inline-flex h-12 items-center gap-2 rounded-full border border-[var(--border-hairline)] bg-[var(--surface-raised)] px-5 text-[13.5px] font-semibold text-[var(--text-muted)] transition hover:text-[var(--text-primary)]"
        >
          <RotateCcw className="h-4 w-4" aria-hidden />
          {zh ? "重新開始" : "Start over"}
        </button>
      </motion.div>
    </div>
  );
}

// ─── Day section: serif heading over a time | detail | cost grid ─────────────

function DaySection({ day, zh, active, onFocus }: { day: HomeItineraryDay; zh: boolean; active: boolean; onFocus: () => void }) {
  const color = DAY_COLORS[(day.dayNumber - 1) % DAY_COLORS.length];
  const fmt = new Intl.DateTimeFormat(zh ? "zh-TW" : "en-US", { weekday: "short", month: "short", day: "numeric" });
  const date = fmt.format(new Date(`${day.date}T00:00:00`));
  return (
    <motion.section
      id={`home-itinerary-day-${day.dayNumber}`}
      variants={fadeUp}
      onMouseEnter={onFocus}
      onClick={onFocus}
      className="cursor-pointer"
    >
      <header
        id={`home-itinerary-day-head-${day.dayNumber}`}
        className="mb-5 flex flex-wrap items-baseline gap-x-3.5 gap-y-1 border-t border-[var(--text-primary)] pt-3.5"
      >
        <span id={`home-itinerary-day-num-${day.dayNumber}`} className="text-[26px] leading-none sm:text-[30px]" style={SERIF}>
          {zh ? `第 ${day.dayNumber} 天` : `Day ${day.dayNumber}`}
          {/* Route-colored tick tying the heading to the map. */}
          <span
            aria-hidden
            className="ml-2 inline-block h-2 w-2 rounded-full align-[0.35em] transition-opacity duration-300"
            style={{ background: color, opacity: active ? 1 : 0.25 }}
          />
        </span>
        <span
          id={`home-itinerary-day-date-${day.dayNumber}`}
          className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]"
        >
          {date} — {day.theme}
        </span>
      </header>

      <div
        id={`home-itinerary-day-stops-${day.dayNumber}`}
        className="grid grid-cols-[64px_1fr_auto] gap-x-4 gap-y-5 pb-9 sm:grid-cols-[80px_1fr_auto] sm:gap-x-5"
      >
        {day.stops.map((stop, i) => (
          <Fragment key={stop.poiId}>
            <div id={`home-itinerary-stop-time-${stop.poiId}`} className="pt-0.5">
              <span className="text-mono block text-[13px] font-semibold leading-tight">{stop.arrive}</span>
              <span className="text-mono block text-[11px] leading-tight text-[var(--text-faint)]">{durationLabel(stop, zh)}</span>
            </div>
            <div id={`home-itinerary-stop-body-${stop.poiId}`} className="min-w-0">
              <p id={`home-itinerary-stop-name-${stop.poiId}`} className="text-[15.5px] font-semibold leading-snug">
                {zh ? stop.nameZh : stop.name}
              </p>
              <p id={`home-itinerary-stop-sub-${stop.poiId}`} className="mt-0.5 line-clamp-1 text-[13px] text-[var(--text-muted)]">
                {stop.city}
                {stop.itemType === "restaurant" && ` · ${zh ? "用餐" : "meal"}`}
                {(() => {
                  const blurb = getHomePoi(stop.poiId);
                  return blurb ? ` · ${zh ? blurb.blurbZh : blurb.blurb}` : "";
                })()}
              </p>
            </div>
            <div id={`home-itinerary-stop-cost-${stop.poiId}`} className="text-right">
              <span className="text-mono block text-[13px] font-semibold leading-tight">
                {stop.costUsd === 0 ? (zh ? "免費" : "free") : stop.costLocal}
              </span>
              {stop.costUsd > 0 && (
                <span className="text-mono block text-[11px] leading-tight text-[var(--text-faint)]">≈ ${stop.costUsd}</span>
              )}
            </div>
            {i < day.stops.length - 1 && (
              <p
                id={`home-itinerary-leg-${stop.poiId}`}
                className="col-span-2 col-start-2 -my-2.5 text-[11px] font-medium tracking-[0.06em] text-[var(--text-faint)]"
              >
                ↳ {legLabel(stop, day.stops[i + 1], zh)}
              </p>
            )}
          </Fragment>
        ))}
      </div>
    </motion.section>
  );
}

// ─── Editorial photo tiles ───────────────────────────────────────────────────

function PhotoTile({ stop, zh, wide, hiddenOnMobile }: { stop: HomeItineraryStop; zh: boolean; wide?: boolean; hiddenOnMobile?: boolean }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const hue = getHomePoi(stop.poiId)?.hue ?? 150;
  return (
    <span
      id={`home-itinerary-photo-${stop.poiId}`}
      className={`relative h-full overflow-hidden rounded-sm ${wide ? "flex-[2]" : "flex-1"} ${hiddenOnMobile ? "hidden sm:block" : "block"}`}
      style={{ background: `linear-gradient(160deg, hsl(${hue} 45% 62%), hsl(${(hue + 42) % 360} 40% 34%))` }}
    >
      {!failed && (
        // eslint-disable-next-line @next/next/no-img-element -- proxied, lazily streamed photo with a designed fallback underneath
        <img
          src={`/api/home/poi-photo?id=${encodeURIComponent(stop.poiId)}&w=640`}
          alt={zh ? stop.nameZh : stop.name}
          loading="lazy"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-700 ${loaded ? "opacity-100" : "opacity-0"}`}
        />
      )}
      <span aria-hidden className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/55 to-transparent" />
      <span className="absolute bottom-3 left-3.5 right-3 truncate text-[10.5px] font-semibold uppercase tracking-[0.12em] text-white/90">
        {zh ? "" : "Photo — "}
        {zh ? stop.nameZh : stop.name}
      </span>
    </span>
  );
}

function FeedThumb({ poiId, emoji, hue }: { poiId: string; emoji: string; hue: number }) {
  const [failed, setFailed] = useState(false);
  return (
    <span
      id={`home-itinerary-feed-thumb-${poiId}`}
      className="relative block h-11 w-11 shrink-0 overflow-hidden rounded-sm"
      style={{ background: `linear-gradient(140deg, hsl(${hue} 45% 60%), hsl(${(hue + 42) % 360} 40% 34%))` }}
      aria-hidden
    >
      <span className="absolute inset-0 grid place-items-center text-[18px] opacity-80">{emoji}</span>
      {!failed && (
        // eslint-disable-next-line @next/next/no-img-element -- proxied, lazily streamed photo with a designed fallback underneath
        <img
          src={`/api/home/poi-photo?id=${encodeURIComponent(poiId)}&w=160`}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
    </span>
  );
}

// ─── Formatting helpers ──────────────────────────────────────────────────────

/** Length of the stay derived from "HH:MM" arrive/depart. */
function durationLabel(stop: HomeItineraryStop, zh: boolean): string {
  const [ah, am] = stop.arrive.split(":").map(Number);
  const [dh, dm] = stop.depart.split(":").map(Number);
  const mins = dh * 60 + dm - (ah * 60 + am);
  if (!Number.isFinite(mins) || mins <= 0) return "";
  if (mins < 60) return zh ? `${mins} 分` : `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return zh ? `${h} 小時${m > 0 ? ` ${m} 分` : ""}` : `${h}h${m > 0 ? ` ${m}m` : ""}`;
}

/** Travel note between stops — heuristics only: 4.5 km/h walking, ~24 km/h
 *  door-to-door transit plus wait. */
function legLabel(from: HomeItineraryStop, to: HomeItineraryStop, zh: boolean): string {
  const km = haversineKm(from, to);
  const walk = km <= 1.9;
  const mins = walk ? Math.max(3, Math.round((km / 4.5) * 60)) : Math.max(8, Math.round((km / 24) * 60) + 8);
  const kmLabel = km < 10 ? km.toFixed(1) : String(Math.round(km));
  return zh
    ? `${kmLabel} 公里 · ${walk ? "步行" : "車程"}約 ${mins} 分`
    : `${kmLabel} km · ~${mins} min ${walk ? "walk" : "transit"}`;
}

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

// ─── SVG fallback map ────────────────────────────────────────────────────────

function SvgItineraryMap({ days, activeDay, onSelectDay }: { days: HomeItineraryDay[]; activeDay: number; onSelectDay: (d: number) => void }) {
  const W = 1000;
  const H = 760;
  const PAD = 90;

  const projected = useMemo(() => {
    const stops = days.flatMap((d) => d.stops);
    const lats = stops.map((s) => s.lat);
    const lngs = stops.map((s) => s.lng);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    const midLat = (minLat + maxLat) / 2;
    const cosLat = Math.max(0.2, Math.cos((midLat * Math.PI) / 180));
    const spanX = Math.max(0.02, (maxLng - minLng) * cosLat);
    const spanY = Math.max(0.02, maxLat - minLat);
    const scale = Math.min((W - PAD * 2) / spanX, (H - PAD * 2) / spanY);
    const cx = ((minLng + maxLng) / 2) * cosLat;
    const cy = midLat;
    const project = (lat: number, lng: number) => ({
      x: W / 2 + (lng * cosLat - cx) * scale,
      y: H / 2 - (lat - cy) * scale,
    });
    return days.map((day) => day.stops.map((s) => ({ ...project(s.lat, s.lng), stop: s })));
  }, [days]);

  // Camera: zoom/pan to the focused day (spring-animated transform on the
  // content group), so multi-city trips read like a map flyover.
  const camera = useMemo(() => {
    const points = projected[days.findIndex((d) => d.dayNumber === activeDay)] ?? [];
    if (points.length === 0) return { scale: 1, x: 0, y: 0 };
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const w = Math.max(40, Math.max(...xs) - Math.min(...xs));
    const h = Math.max(40, Math.max(...ys) - Math.min(...ys));
    const scale = Math.max(1, Math.min(2.6, Math.min((W * 0.62) / w, (H * 0.62) / h)));
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    return { scale, x: W / 2 - cx * scale, y: H / 2 - cy * scale };
  }, [projected, days, activeDay]);

  return (
    <svg
      id="home-itinerary-svg-map"
      viewBox={`0 0 ${W} ${H}`}
      className="h-full w-full bg-[var(--surface-sunken)]"
      role="img"
      aria-label="Itinerary map"
      preserveAspectRatio="xMidYMid slice"
    >
      <defs>
        <pattern id="home-map-grid" width="46" height="46" patternUnits="userSpaceOnUse">
          <circle cx="1.5" cy="1.5" r="1.5" fill="currentColor" opacity="0.12" />
        </pattern>
        <radialGradient id="home-map-glow" cx="30%" cy="25%" r="80%">
          <stop offset="0%" stopColor="#00b900" stopOpacity="0.10" />
          <stop offset="55%" stopColor="#1fb6c9" stopOpacity="0.05" />
          <stop offset="100%" stopColor="#7c5cff" stopOpacity="0.04" />
        </radialGradient>
      </defs>
      <rect id="home-map-bg-glow" width={W} height={H} fill="url(#home-map-glow)" />
      <rect id="home-map-bg-grid" width={W} height={H} fill="url(#home-map-grid)" className="text-[var(--text-muted)]" />

      {/* Plain CSS camera: framer forces fill-box origins on SVG, so the
          zoom/pan transform is computed against the view-box and transitioned
          by hand. */}
      <g
        id="home-map-camera"
        style={{
          transform: `translate(${camera.x.toFixed(1)}px, ${camera.y.toFixed(1)}px) scale(${camera.scale.toFixed(3)})`,
          transformOrigin: "0 0",
          transformBox: "view-box",
          transition: "transform 950ms var(--ease-confirm)",
        }}
      >
      {projected.map((points, di) => {
        const dayNumber = days[di].dayNumber;
        const color = DAY_COLORS[(dayNumber - 1) % DAY_COLORS.length];
        const active = activeDay === dayNumber;
        const path = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
        return (
          <g
            key={dayNumber}
            id={`home-map-day-${dayNumber}`}
            opacity={active ? 1 : 0.28}
            style={{ transition: "opacity 400ms var(--ease-confirm)", cursor: "pointer" }}
            onClick={() => onSelectDay(dayNumber)}
          >
            {points.length > 1 && (
              <motion.path
                id={`home-map-route-${dayNumber}`}
                d={path}
                fill="none"
                stroke={color}
                strokeWidth={4}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray="2 12"
                vectorEffect="non-scaling-stroke"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 1.4, delay: di * 0.35, ease: "easeInOut" }}
              />
            )}
            {points.map((p, i) => (
              <motion.g
                key={days[di].stops[i].poiId}
                id={`home-map-stop-${days[di].stops[i].poiId}`}
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1 / camera.scale, opacity: 1 }}
                transition={{ delay: di * 0.35 + i * 0.12, type: "spring", stiffness: 320, damping: 22 }}
                style={{ transformOrigin: `${p.x}px ${p.y}px` }}
              >
                {active && <circle cx={p.x} cy={p.y} r={26} fill={color} opacity={0.16} />}
                <circle cx={p.x} cy={p.y} r={15} fill={color} stroke="white" strokeWidth={3} />
                <text
                  x={p.x}
                  y={p.y + 5}
                  textAnchor="middle"
                  fontSize={15}
                  fontWeight={700}
                  fill="white"
                  style={{ fontFamily: "var(--font-text)" }}
                >
                  {i + 1}
                </text>
              </motion.g>
            ))}
          </g>
        );
      })}
      </g>
    </svg>
  );
}

// ─── Google Maps variant (used when a browser key is configured) ─────────────

function GoogleItineraryMap({ days, activeDay }: { days: HomeItineraryDay[]; activeDay: number }) {
  const first = days[0]?.stops[0];
  return (
    <APIProvider apiKey={MAPS_BROWSER_KEY}>
      <GoogleMap
        id="home-itinerary-google-map"
        defaultCenter={{ lat: first?.lat ?? 0, lng: first?.lng ?? 0 }}
        defaultZoom={11}
        gestureHandling="cooperative"
        disableDefaultUI
        zoomControl
        className="h-full w-full"
      >
        {days.map((day) => {
          const color = DAY_COLORS[(day.dayNumber - 1) % DAY_COLORS.length];
          const active = activeDay === day.dayNumber;
          return day.stops.map((stop, i) => (
            <Marker
              key={stop.poiId}
              position={{ lat: stop.lat, lng: stop.lng }}
              label={{ text: String(i + 1), color: "#ffffff", fontWeight: "700", fontSize: "12px" }}
              opacity={active ? 1 : 0.45}
              icon={{
                path: "M 0,0 m -12,0 a 12,12 0 1,0 24,0 a 12,12 0 1,0 -24,0",
                fillColor: color,
                fillOpacity: 1,
                strokeColor: "#ffffff",
                strokeWeight: 2.5,
              }}
            />
          ));
        })}
        <DayPolylines days={days} activeDay={activeDay} />
        <FitToDay days={days} activeDay={activeDay} />
      </GoogleMap>
    </APIProvider>
  );
}

function DayPolylines({ days, activeDay }: { days: HomeItineraryDay[]; activeDay: number }) {
  const map = useMap();
  const mapsLib = useMapsLibrary("maps");
  const polylinesRef = useRef<google.maps.Polyline[]>([]);

  useEffect(() => {
    if (!map || !mapsLib) return;
    for (const p of polylinesRef.current) p.setMap(null);
    polylinesRef.current = [];

    for (const day of days) {
      if (day.stops.length < 2) continue;
      const color = DAY_COLORS[(day.dayNumber - 1) % DAY_COLORS.length];
      const poly = new mapsLib.Polyline({
        path: day.stops.map((s) => ({ lat: s.lat, lng: s.lng })),
        strokeOpacity: 0,
        icons: [
          {
            icon: { path: "M 0,-1 0,1", strokeOpacity: activeDay === day.dayNumber ? 0.95 : 0.3, strokeColor: color, strokeWeight: 3, scale: 3 },
            offset: "0",
            repeat: "14px",
          },
        ],
        map,
      });
      polylinesRef.current.push(poly);
    }
    return () => {
      for (const p of polylinesRef.current) p.setMap(null);
      polylinesRef.current = [];
    };
  }, [map, mapsLib, days, activeDay]);

  return null;
}

function FitToDay({ days, activeDay }: { days: HomeItineraryDay[]; activeDay: number }) {
  const map = useMap();
  const coreLib = useMapsLibrary("core");

  useEffect(() => {
    if (!map || !coreLib) return;
    const day = days.find((d) => d.dayNumber === activeDay);
    const stops = day && day.stops.length > 0 ? day.stops : days.flatMap((d) => d.stops);
    if (stops.length === 0) return;
    const bounds = new coreLib.LatLngBounds();
    for (const s of stops) bounds.extend({ lat: s.lat, lng: s.lng });
    map.fitBounds(bounds, 64);
  }, [map, coreLib, days, activeDay]);

  return null;
}

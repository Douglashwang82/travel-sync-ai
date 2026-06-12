'use client'

// ─────────────────────────────────────────────────────────────────────────────
// ItineraryScene — phase 4 of the index-page survey pipeline.
//
// The generated plan takes over the stage: an animated map on the left (a
// real Google Map when NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_API_KEY is configured,
// otherwise a hand-rolled animated SVG map with day routes drawing themselves
// in) and the day-by-day plan on the right with dates, arrive/depart times
// and expected costs per stop, per day and per trip. Days auto-cycle on the
// map; hovering or tapping a day card focuses it.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { APIProvider, Map as GoogleMap, Marker, useMap, useMapsLibrary } from "@vis.gl/react-google-maps";
import { ArrowRight, CalendarDays, MapPin, RotateCcw, Wallet } from "lucide-react";
import type { HomeCountry, HomeItinerary, HomeItineraryDay } from "@/lib/home-survey";
import { fadeUp, staggerContainer } from "@/components/motion/variants";

const DAY_COLORS = ["#00b900", "#1fb6c9", "#7c5cff", "#ff5d5d", "#e08c00", "#d62976"];

const MAPS_BROWSER_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_API_KEY ?? "";

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
    pauseUntilRef.current = Date.now() + 12_000;
    setActiveDay(day);
  };

  const dateRange = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(zh ? "zh-TW" : "en-US", { month: "short", day: "numeric" });
    const first = new Date(`${itinerary.days[0]?.date}T00:00:00`);
    const last = new Date(`${itinerary.days[itinerary.days.length - 1]?.date}T00:00:00`);
    return `${fmt.format(first)} – ${fmt.format(last)}`;
  }, [itinerary.days, zh]);

  return (
    <div id="home-itinerary-scene" className="mx-auto w-full max-w-6xl px-5 pb-24 sm:px-8">
      {/* Trip header */}
      <motion.header
        id="home-itinerary-header"
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-6 text-center"
      >
        <p id="home-itinerary-summary" className="mx-auto mt-2 max-w-2xl text-[14.5px] leading-7 text-[var(--text-muted)]">
          {itinerary.summary}
        </p>
        <div id="home-itinerary-meta" className="mt-4 flex flex-wrap items-center justify-center gap-2">
          <span id="home-itinerary-meta-dates" className="chip-gradient inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold">
            <CalendarDays className="h-3.5 w-3.5 text-[var(--accent-line)]" aria-hidden />
            {dateRange} · {itinerary.days.length} {zh ? "天" : itinerary.days.length === 1 ? "day" : "days"}
          </span>
          <span id="home-itinerary-meta-cost" className="chip-gradient inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold">
            <Wallet className="h-3.5 w-3.5 text-[var(--accent-line)]" aria-hidden />
            {zh ? "預估" : "est."} {itinerary.totalCostLocal}
            {country.currency.code !== "USD" && (
              <span id="home-itinerary-meta-cost-usd" className="text-[var(--text-muted)]">≈ ${itinerary.totalCostUsd.toLocaleString("en-US")}</span>
            )}
          </span>
          <span id="home-itinerary-meta-country" className="chip-gradient inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold">
            <span aria-hidden>{country.flag}</span>
            {zh ? country.nameZh : country.name}
          </span>
        </div>
      </motion.header>

      <div id="home-itinerary-body" className="grid items-start gap-5 lg:grid-cols-[1.05fr_0.95fr]">
        {/* Map panel */}
        <motion.div
          id="home-itinerary-map-panel"
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.45 }}
          className="surface-tile-raised sticky top-20 overflow-hidden p-0"
        >
          <div id="home-itinerary-map-frame" className="relative aspect-[5/4] w-full sm:aspect-[16/11]">
            {MAPS_BROWSER_KEY ? (
              <GoogleItineraryMap days={itinerary.days} activeDay={activeDay} />
            ) : (
              <SvgItineraryMap days={itinerary.days} activeDay={activeDay} onSelectDay={focusDay} />
            )}
          </div>
          <div id="home-itinerary-day-chips" className="flex flex-wrap gap-1.5 border-t border-[var(--border-hairline)] p-3">
            {itinerary.days.map((day) => {
              const color = DAY_COLORS[(day.dayNumber - 1) % DAY_COLORS.length];
              const active = activeDay === day.dayNumber;
              return (
                <button
                  key={day.dayNumber}
                  id={`home-itinerary-day-chip-${day.dayNumber}`}
                  type="button"
                  onClick={() => focusDay(day.dayNumber)}
                  aria-pressed={active}
                  className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-bold transition-all duration-200"
                  style={{
                    borderColor: active ? color : "var(--border-hairline)",
                    background: active ? `color-mix(in oklab, ${color} 14%, transparent)` : "transparent",
                    color: active ? color : "var(--text-muted)",
                  }}
                >
                  <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: color }} />
                  {zh ? `第 ${day.dayNumber} 天` : `Day ${day.dayNumber}`}
                </button>
              );
            })}
          </div>
        </motion.div>

        {/* Plan panel */}
        <motion.div id="home-itinerary-plan" variants={staggerContainer} initial="hidden" animate="show" className="space-y-4">
          {itinerary.days.map((day) => (
            <DayCard
              key={day.dayNumber}
              day={day}
              zh={zh}
              active={activeDay === day.dayNumber}
              color={DAY_COLORS[(day.dayNumber - 1) % DAY_COLORS.length]}
              onFocus={() => focusDay(day.dayNumber)}
            />
          ))}

          <motion.div id="home-itinerary-ctas" variants={fadeUp} className="flex flex-wrap items-center gap-3 pt-2">
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
        </motion.div>
      </div>
    </div>
  );
}

// ─── Day card ────────────────────────────────────────────────────────────────

function DayCard({ day, zh, active, color, onFocus }: { day: HomeItineraryDay; zh: boolean; active: boolean; color: string; onFocus: () => void }) {
  const fmt = new Intl.DateTimeFormat(zh ? "zh-TW" : "en-US", { weekday: "short", month: "short", day: "numeric" });
  const date = fmt.format(new Date(`${day.date}T00:00:00`));
  return (
    <motion.article
      id={`home-itinerary-day-${day.dayNumber}`}
      variants={fadeUp}
      onMouseEnter={onFocus}
      onClick={onFocus}
      className="surface-tile-raised cursor-pointer p-4 transition-shadow duration-300 sm:p-5"
      style={active ? { boxShadow: `var(--shadow-raise), 0 0 0 2px ${color}` } : undefined}
    >
      <header id={`home-itinerary-day-head-${day.dayNumber}`} className="mb-3 flex items-baseline justify-between gap-3">
        <div id={`home-itinerary-day-title-wrap-${day.dayNumber}`} className="flex items-baseline gap-2.5">
          <span
            id={`home-itinerary-day-num-${day.dayNumber}`}
            className="text-display text-[22px]"
            style={{ color }}
          >
            {zh ? `第${day.dayNumber}天` : `Day ${day.dayNumber}`}
          </span>
          <span id={`home-itinerary-day-date-${day.dayNumber}`} className="text-mono text-[12px] font-semibold text-[var(--text-muted)]">{date}</span>
        </div>
        <span id={`home-itinerary-day-cost-${day.dayNumber}`} className="text-mono shrink-0 text-[12.5px] font-bold text-[var(--text-secondary)]">
          ${day.dayCostUsd.toLocaleString("en-US")}
        </span>
      </header>
      <p id={`home-itinerary-day-theme-${day.dayNumber}`} className="mb-3 text-[13px] font-medium text-[var(--text-muted)]">{day.theme}</p>

      <ol id={`home-itinerary-day-stops-${day.dayNumber}`} className="relative space-y-0">
        {day.stops.map((stop, i) => (
          <li key={stop.poiId} id={`home-itinerary-stop-${stop.poiId}`} className="relative flex gap-3 pb-4 last:pb-0">
            {i < day.stops.length - 1 && (
              <span
                aria-hidden
                className="absolute left-[13px] top-7 h-[calc(100%-22px)] w-px border-l border-dashed"
                style={{ borderColor: `color-mix(in oklab, ${color} 45%, transparent)` }}
              />
            )}
            <span
              id={`home-itinerary-stop-dot-${stop.poiId}`}
              className="z-10 grid h-7 w-7 shrink-0 place-items-center rounded-full text-[12px] font-bold text-white"
              style={{ background: color }}
            >
              {i + 1}
            </span>
            <span id={`home-itinerary-stop-body-${stop.poiId}`} className="min-w-0 flex-1">
              <span id={`home-itinerary-stop-name-${stop.poiId}`} className="flex items-baseline justify-between gap-2">
                <span className="truncate text-[14px] font-semibold">
                  <span aria-hidden className="mr-1">{stop.emoji}</span>
                  {zh ? stop.nameZh : stop.name}
                </span>
                <span id={`home-itinerary-stop-cost-${stop.poiId}`} className="text-mono shrink-0 text-[12px] font-semibold text-[var(--text-muted)]">
                  {stop.costUsd === 0 ? (zh ? "免費" : "free") : stop.costLocal}
                </span>
              </span>
              <span id={`home-itinerary-stop-times-${stop.poiId}`} className="text-mono mt-0.5 block text-[11.5px] text-[var(--text-muted)]">
                {stop.arrive} – {stop.depart} · {stop.city}
              </span>
            </span>
          </li>
        ))}
      </ol>

      <footer id={`home-itinerary-day-foot-${day.dayNumber}`} className="mt-3 flex items-center gap-2 border-t border-[var(--border-hairline)] pt-2.5 text-[11.5px] font-medium text-[var(--text-faint)]">
        <MapPin className="h-3.5 w-3.5" aria-hidden />
        {zh ? `當日移動約 ${day.travelKm} 公里` : `~${day.travelKm} km on the move`}
      </footer>
    </motion.article>
  );
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

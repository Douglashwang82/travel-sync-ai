'use client'

// CityScene - phase 2 of the index-page survey pipeline.
//
// After a country is selected on the full globe, this scene keeps the same
// dotted earth language but moves the camera closer to the available cities.
// City markers are HTML buttons, mirroring GlobeScene's accessible marker
// pattern while the canvas handles the earth, pulse rings and camera zoom.

import { useEffect, useMemo, useRef } from "react";
import { ChevronLeft } from "lucide-react";
import { buildLandDots, computeFocusRadius, focusCenter } from "@/components/home/globe-scene";
import { getHomeCities, type HomeCity, type HomeCountry } from "@/lib/home-survey";

const TAU = Math.PI * 2;
const CITY_LAND_DOT_STEP = 0.62;

interface CitySceneProps {
  country: HomeCountry;
  locale: "en" | "zh-TW";
  selected: string | null;
  onSelect: (city: HomeCity) => void;
  onBack: () => void;
}

export default function CityScene({ country, locale, selected, onSelect, onBack }: CitySceneProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const glassRef = useRef<HTMLDivElement | null>(null);
  const markerRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const cities = useMemo(() => getHomeCities(country.code), [country.code]);
  const markerOffsets = useMemo(() => new Map(cities.map((city, index) => [city.id, markerOffset(city, index, cities)])), [cities]);
  const zh = locale === "zh-TW";

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dots = buildLandDots(CITY_LAND_DOT_STEP);
    const focus = focusCenter(cities);
    const targetRotY = -toRad(focus.lng);
    const targetTilt = clamp(toRad(focus.lat), -0.72, 0.72);
    const isDark = () => document.documentElement.classList.contains("dark");

    // GlobeScene's dive already zoomed all the way to this exact focus, so we
    // start fully landed (centred, at the fitted radius) and only run the idle /
    // drag behaviour from here — no second zoom animation.
    let rotY = targetRotY;
    let tilt = targetTilt;
    let velY = 0;
    let dragging = false;
    let lastPointer: { x: number; y: number; t: number } | null = null;
    let lastInteraction = 0;
    let raf = 0;
    let width = 0;
    let height = 0;
    let dpr = 1;
    let cx = 0;
    let cy = 0;
    let baseR = 0;
    let targetR = 0;
    let R = 0;

    const projectAt = (lat: number, lng: number, nextRotY: number, nextTilt: number) => {
      const phi = toRad(lat);
      const lambda = toRad(lng) + nextRotY;
      const x = Math.cos(phi) * Math.sin(lambda);
      const y0 = Math.sin(phi);
      const z0 = Math.cos(phi) * Math.cos(lambda);
      const y = y0 * Math.cos(nextTilt) - z0 * Math.sin(nextTilt);
      const z = y0 * Math.sin(nextTilt) + z0 * Math.cos(nextTilt);
      return { x, y, z };
    };

    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      width = wrap.clientWidth;
      height = wrap.clientHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      baseR = Math.min(Math.max(width * 0.45, (height - 24) / 2), width * 1.35, height * 1.1);
      targetR = computeFocusRadius(cities, baseR, width, height, projectAt, targetRotY, targetTilt);
      R = targetR;
      cx = width / 2;
      cy = height * 0.54;

      const glass = glassRef.current;
      if (glass) {
        glass.style.left = `${cx - targetR}px`;
        glass.style.top = `${cy - targetR}px`;
        glass.style.width = `${2 * targetR}px`;
        glass.style.height = `${2 * targetR}px`;
      }
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    const project = (lat: number, lng: number) => projectAt(lat, lng, rotY, tilt);

    let lastTime = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(64, now - lastTime) / 1000;
      lastTime = now;

      if (!dragging) {
        R = targetR;
        if (Math.abs(velY) > 0.0001) {
          rotY += velY * dt;
          velY *= Math.pow(0.045, dt);
        } else if (now - lastInteraction > 1400) {
          rotY += angularDelta(rotY, targetRotY) * Math.min(1, dt * 1.35);
          tilt += (targetTilt - tilt) * Math.min(1, dt * 1.35);
        }
      }

      const dark = isDark();

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const base = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.1, cx, cy, R);
      if (dark) {
        base.addColorStop(0, "rgba(43, 210, 74, 0.22)");
        base.addColorStop(0.58, "rgba(63, 208, 227, 0.13)");
        base.addColorStop(1, "rgba(12, 30, 25, 0.24)");
      } else {
        base.addColorStop(0, "rgba(235, 255, 242, 0.52)");
        base.addColorStop(0.58, "rgba(31, 182, 201, 0.2)");
        base.addColorStop(1, "rgba(33, 111, 112, 0.14)");
      }
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, TAU);
      ctx.fillStyle = base;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = dark ? "rgba(239,236,226,0.28)" : "rgba(20,55,43,0.26)";
      ctx.stroke();

      const dotBase = dark ? "232,246,235" : "18,48,38";
      const cosTilt = Math.cos(tilt);
      const sinTilt = Math.sin(tilt);
      for (const d of dots) {
        const lam = d.lambda + rotY;
        const x = d.cosPhi * Math.sin(lam);
        const z0 = d.cosPhi * Math.cos(lam);
        const y = d.sinPhi * cosTilt - z0 * sinTilt;
        const z = d.sinPhi * sinTilt + z0 * cosTilt;
        if (z <= 0) continue;
        const px = cx + x * R;
        const py = cy - y * R;
        if (px < -12 || px > width + 12 || py < -12 || py > height + 12) continue;
        const alpha = 0.42 + 0.5 * z;
        const size = (0.45 + 0.52 * z) * (R / 420);
        ctx.beginPath();
        ctx.arc(px, py, size, 0, TAU);
        ctx.fillStyle = `rgba(${dotBase},${alpha.toFixed(3)})`;
        ctx.fill();
      }

      ctx.beginPath();
      ctx.arc(cx, cy, R - 1.5, Math.PI * 0.85, Math.PI * 1.62);
      ctx.strokeStyle = dark ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.72)";
      ctx.lineWidth = 2.5;
      ctx.lineCap = "round";
      ctx.stroke();

      cities.forEach((city, index) => {
        const p = project(city.lat, city.lng);
        const btn = markerRefs.current.get(city.id);
        const offset = markerOffsets.get(city.id) ?? { x: 0, y: 0 };
        const px = cx + p.x * R;
        const py = cy - p.y * R;
        const markerX = px + offset.x;
        const markerY = py + offset.y;
        const visible = p.z > 0.06 && markerX > -160 && markerX < width + 160 && markerY > -160 && markerY < height + 160;

        if (p.z > 0.04) {
          const pulse = ((now / 1400) % 1 + index / Math.max(1, cities.length)) % 1;
          ctx.beginPath();
          ctx.arc(markerX, markerY, 6 + pulse * 16, 0, TAU);
          ctx.strokeStyle = dark
            ? `rgba(43,210,74,${(0.5 * (1 - pulse)).toFixed(3)})`
            : `rgba(0,185,0,${(0.45 * (1 - pulse)).toFixed(3)})`;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }

        if (btn) {
          btn.style.transform = `translate3d(${markerX.toFixed(1)}px, ${markerY.toFixed(1)}px, 0) translate(-50%, -100%) translateY(8px) scale(${(0.9 + 0.18 * Math.max(0, p.z)).toFixed(3)})`;
          btn.style.opacity = visible ? "1" : "0";
          btn.style.pointerEvents = visible ? "auto" : "none";
          btn.style.zIndex = visible ? "6" : "0";
        }
      });

      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    const onPointerDown = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest("button")) return;
      dragging = true;
      lastPointer = { x: e.clientX, y: e.clientY, t: performance.now() };
      lastInteraction = performance.now();
      canvas.setPointerCapture(e.pointerId);
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!dragging || !lastPointer) return;
      const nowT = performance.now();
      const dx = e.clientX - lastPointer.x;
      const dy = e.clientY - lastPointer.y;
      rotY += dx * 0.0028;
      tilt = clamp(tilt + dy * 0.0024, -0.72, 0.72);
      const dtMs = Math.max(1, nowT - lastPointer.t);
      velY = clamp((dx * 0.0028) / (dtMs / 1000), -1, 1);
      lastPointer = { x: e.clientX, y: e.clientY, t: nowT };
      lastInteraction = nowT;
    };
    const endDrag = () => {
      dragging = false;
      lastPointer = null;
      lastInteraction = performance.now();
    };
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", endDrag);
    canvas.addEventListener("pointercancel", endDrag);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", endDrag);
      canvas.removeEventListener("pointercancel", endDrag);
    };
  }, [cities, markerOffsets]);

  return (
    <div
      id="home-city-globe"
      ref={wrapRef}
      className="relative mx-auto h-full min-h-[420px] w-full flex-1 cursor-grab touch-none select-none overflow-hidden active:cursor-grabbing"
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex justify-center px-5 pt-2 sm:pt-4">
        <button
          id="home-city-back"
          type="button"
          onClick={onBack}
          className="surface-glass pointer-events-auto inline-flex h-9 items-center gap-1 rounded-full border border-[var(--border-hairline)] px-3.5 text-[13px] font-semibold text-[var(--text-muted)] shadow-[var(--shadow-raise)] transition hover:text-[var(--text-primary)]"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
          {zh ? "重選國家" : "Change country"}
        </button>
      </div>

      <div
        id="home-city-glass"
        ref={glassRef}
        aria-hidden
        className="pointer-events-none absolute rounded-full border border-white/35 bg-[radial-gradient(circle_at_32%_26%,rgba(255,255,255,0.36),rgba(255,255,255,0.10)_38%,rgba(255,255,255,0.03)_58%,rgba(255,255,255,0.015)_78%)] shadow-[inset_0_1px_1px_rgba(255,255,255,0.55),inset_0_-30px_70px_rgba(20,60,30,0.07),0_50px_140px_-50px_rgba(0,110,55,0.45)] backdrop-blur-[7px] backdrop-saturate-150 dark:border-white/15 dark:bg-[radial-gradient(circle_at_32%_26%,rgba(255,255,255,0.13),rgba(255,255,255,0.04)_40%,rgba(255,255,255,0.01)_60%,transparent_78%)] dark:shadow-[inset_0_1px_1px_rgba(255,255,255,0.18),0_50px_140px_-50px_rgba(43,210,74,0.35)]"
      />

      <canvas id="home-city-canvas" ref={canvasRef} className="absolute inset-0" aria-hidden />

      {cities.map((city) => {
        const isSelected = selected === city.name;
        return (
          <button
            key={city.id}
            id={`home-city-marker-${city.id}`}
            ref={(el) => {
              if (el) markerRefs.current.set(city.id, el);
              else markerRefs.current.delete(city.id);
            }}
            type="button"
            onClick={() => onSelect(city)}
            aria-label={zh ? `選擇${city.nameZh}` : `Choose ${city.name}`}
            className="group absolute left-0 top-0 flex flex-col items-center gap-1.5 outline-none transition-opacity duration-200"
            style={{ opacity: 0, pointerEvents: "none" }}
          >
            <span aria-hidden>
              <span
                id={`home-city-marker-label-${city.id}`}
                className="surface-glass flex items-center gap-1.5 whitespace-nowrap rounded-full border border-[var(--border-hairline)] px-3 py-1.5 text-[13px] font-semibold shadow-[var(--shadow-raise)] transition-transform duration-200 group-hover:-translate-y-0.5"
              >
                <span id={`home-city-marker-flag-${city.id}`}>{country.flag}</span>
                {zh ? city.nameZh : city.name}
                <span className="text-[10px] font-bold text-[var(--text-muted)]">{city.poiCount}</span>
              </span>
            </span>
            <span
              id={`home-city-marker-dot-${city.id}`}
              className={`grid h-4 w-4 place-items-center rounded-full border-2 border-white bg-[var(--accent-line)] shadow-[0_0_0_4px_color-mix(in_oklab,var(--accent-line)_25%,transparent)] transition-transform duration-200 group-hover:scale-125 group-focus-visible:scale-125 dark:border-[#16170f] ${
                isSelected ? "scale-150" : ""
              }`}
            />
          </button>
        );
      })}
    </div>
  );
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function angularDelta(from: number, to: number): number {
  return ((((to - from + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
}

function markerOffset(city: HomeCity, index: number, cities: HomeCity[]): { x: number; y: number } {
  const nearest = cities.reduce((best, other) => {
    if (other.id === city.id) return best;
    return Math.min(best, distanceKm(city, other));
  }, Number.POSITIVE_INFINITY);

  if (nearest > 90) return { x: 0, y: 0 };
  if (cities.length === 2) return { x: index === 0 ? -72 : 72, y: index === 0 ? -6 : 10 };

  const angle = -Math.PI / 2 + (index * TAU) / cities.length;
  return { x: Math.round(Math.cos(angle) * 64), y: Math.round(Math.sin(angle) * 28) };
}

function distanceKm(a: Pick<HomeCity, "lat" | "lng">, b: Pick<HomeCity, "lat" | "lng">): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

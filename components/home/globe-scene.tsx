'use client'

// ─────────────────────────────────────────────────────────────────────────────
// GlobeScene — phase 1 of the index-page survey pipeline.
//
// A dependency-free spinning earth: stylized continents are rasterized into a
// dot matrix (point-in-polygon over coarse landmass outlines, sampled with
// cos(lat) spacing so density is even on the sphere) and orthographically
// projected on a <canvas>. Available countries render as HTML marker buttons
// repositioned every frame, so they stay accessible (focusable, labelled)
// while tracking the rotation. Drag to spin; auto-rotation pauses on
// interaction and under prefers-reduced-motion.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef } from "react";
import { HOME_COUNTRIES, type HomeCountryCode } from "@/lib/home-survey";

type LngLat = [number, number];

// Coarse landmass outlines (lng, lat). Intentionally low-fidelity: at dot
// resolution they read as "the world" without shipping a geo dataset.
const LANDMASSES: LngLat[][] = [
  // North America
  [[-166, 68], [-150, 71], [-130, 71], [-110, 73], [-90, 73], [-75, 72], [-60, 62], [-55, 52], [-65, 45], [-70, 42], [-75, 36], [-80, 31], [-81, 25], [-90, 29], [-95, 27], [-97, 22], [-94, 17], [-83, 9], [-79, 8], [-85, 12], [-92, 15], [-105, 20], [-110, 24], [-117, 33], [-124, 40], [-125, 49], [-132, 55], [-140, 60], [-152, 60], [-160, 55], [-166, 62]],
  // Greenland
  [[-58, 76], [-44, 83], [-30, 83], [-20, 76], [-25, 70], [-40, 60], [-48, 61], [-55, 68]],
  // South America
  [[-78, 8], [-70, 11], [-60, 9], [-52, 4], [-50, 0], [-44, -3], [-35, -7], [-39, -15], [-41, -22], [-48, -28], [-53, -34], [-58, -39], [-65, -42], [-66, -50], [-69, -55], [-73, -50], [-71, -40], [-71, -30], [-70, -18], [-77, -12], [-81, -5], [-78, 2]],
  // Africa
  [[-17, 15], [-16, 22], [-10, 30], [0, 35], [10, 37], [20, 32], [30, 31], [34, 28], [43, 11], [51, 11], [48, 2], [40, -10], [36, -18], [33, -26], [27, -34], [19, -35], [14, -28], [12, -18], [9, -2], [6, 5], [-5, 5], [-12, 8]],
  // Eurasia
  [[-10, 37], [-8, 44], [2, 51], [8, 57], [5, 62], [12, 66], [20, 70], [30, 70], [45, 68], [60, 70], [80, 73], [100, 77], [120, 73], [140, 72], [160, 70], [180, 66], [178, 62], [160, 60], [155, 53], [140, 45], [135, 43], [130, 35], [122, 30], [110, 20], [105, 10], [103, 2], [98, 8], [92, 20], [88, 22], [80, 15], [77, 8], [73, 18], [67, 24], [57, 26], [48, 30], [35, 36], [27, 36], [22, 38], [15, 38], [5, 36], [-10, 37]],
  // Arabia
  [[33, 29], [39, 16], [44, 12], [54, 17], [60, 24], [55, 30], [45, 31]],
  // British Isles
  [[-5, 50], [-3, 53], [-2, 57], [-4, 58], [-6, 55], [-5, 51]],
  // Scandinavia
  [[5, 58], [10, 63], [18, 69], [25, 71], [28, 70], [21, 64], [17, 59], [10, 57]],
  // Japan (Kyushu–Honshu arc)
  [[129.5, 31], [131, 33.5], [134, 34.5], [137, 35.2], [139.5, 35.5], [140.8, 38], [141.5, 41.3], [140, 40], [138, 37], [134, 35.6], [130.5, 33]],
  // Hokkaido
  [[140, 42], [143, 44.5], [145.5, 43.5], [143, 41.8]],
  // Taiwan
  [[120.1, 22.4], [120.7, 25.2], [122, 25], [121.2, 22.4]],
  // Borneo
  [[109, 1], [114, 6], [117, 7], [119, 1], [113, -3]],
  // Sumatra + Java
  [[95, 5], [102, -1], [106, -6], [112, -7.6], [115, -8.4], [110, -7], [104, -4], [97, 3]],
  // New Guinea
  [[131, -1], [138, -2], [144, -4], [147, -7], [141, -8], [134, -4]],
  // Australia
  [[114, -22], [122, -18], [130, -12], [136, -12], [142, -11], [146, -15], [149, -21], [153, -27], [150, -35], [146, -39], [140, -38], [135, -35], [129, -32], [124, -33], [115, -34], [113, -26]],
  // New Zealand
  [[173, -35], [176, -38], [174, -41], [170, -44], [167, -46], [170, -41]],
  // Madagascar
  [[44, -12], [50, -16], [47, -25], [44, -20]],
];

interface LandDot { cosPhi: number; sinPhi: number; lambda: number }

let landDotsCache: LandDot[] | null = null;

function pointInPolygon(lng: number, lat: number, poly: LngLat[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function buildLandDots(): LandDot[] {
  if (landDotsCache) return landDotsCache;
  const dots: LandDot[] = [];
  const latStep = 1.7; // denser sampling so continents read clearly at hero size
  for (let lat = -58; lat <= 80; lat += latStep) {
    const cos = Math.cos((lat * Math.PI) / 180);
    const lngStep = latStep / Math.max(0.18, cos);
    for (let lng = -180; lng < 180; lng += lngStep) {
      if (!LANDMASSES.some((poly) => pointInPolygon(lng, lat, poly))) continue;
      const phi = (lat * Math.PI) / 180;
      dots.push({
        cosPhi: Math.cos(phi),
        sinPhi: Math.sin(phi),
        lambda: (lng * Math.PI) / 180,
      });
    }
  }
  landDotsCache = dots;
  return dots;
}

interface GlobeSceneProps {
  locale: "en" | "zh-TW";
  /** Country the user just clicked (drives the marker's selected ring). */
  selected: HomeCountryCode | null;
  onSelect: (code: HomeCountryCode) => void;
}

export default function GlobeScene({ locale, selected, onSelect }: GlobeSceneProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const glassRef = useRef<HTMLDivElement | null>(null);
  const markerRefs = useRef<Map<HomeCountryCode, HTMLButtonElement>>(new Map());

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dots = buildLandDots();
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Tailwind's dark variant and the page tokens are class-driven. Following
    // the OS preference here would paint white land over an otherwise light UI.
    const isDark = () => document.documentElement.classList.contains("dark");

    // Rotation state lives in refs-like locals; the RAF loop owns rendering.
    let rotY = (-138 * Math.PI) / 180; // start with East Asia facing the viewer
    let tilt = 0.26;
    let velY = 0;
    let dragging = false;
    let lastPointer: { x: number; y: number; t: number } | null = null;
    let lastInteraction = 0;
    let raf = 0;
    let width = 0;
    let height = 0;
    let dpr = 1;
    // Sphere geometry — owned by resize() so the canvas, the glass overlay
    // and the marker projection all agree.
    let cx = 0;
    let cy = 0;
    let R = 0;

    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      width = wrap.clientWidth;
      height = wrap.clientHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      // The sphere targets 90% of the stage width. On short viewports it
      // outgrows the wrapper and rises like a planet over the fold — the
      // height*1.1 cap keeps the marker band (lat 20–45°N) on screen.
      R = Math.min(width * 0.45, height * 1.1);
      cx = width / 2;
      cy = height >= 2 * R + 48 ? height / 2 : 24 + R;

      const glass = glassRef.current;
      if (glass) {
        glass.style.left = `${cx - R}px`;
        glass.style.top = `${cy - R}px`;
        glass.style.width = `${2 * R}px`;
        glass.style.height = `${2 * R}px`;
      }
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    const project = (lat: number, lng: number) => {
      const phi = (lat * Math.PI) / 180;
      const lambda = (lng * Math.PI) / 180 + rotY;
      const x = Math.cos(phi) * Math.sin(lambda);
      const y0 = Math.sin(phi);
      const z0 = Math.cos(phi) * Math.cos(lambda);
      const y = y0 * Math.cos(tilt) - z0 * Math.sin(tilt);
      const z = y0 * Math.sin(tilt) + z0 * Math.cos(tilt);
      return { x, y, z };
    };

    let lastTime = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(64, now - lastTime) / 1000;
      lastTime = now;

      // Auto-rotate when idle; carry drag inertia with decay.
      if (!dragging) {
        const idleFor = now - lastInteraction;
        const auto = reduceMotion ? 0 : 0.07;
        if (Math.abs(velY) > 0.0001) {
          rotY += velY * dt;
          velY *= Math.pow(0.04, dt); // strong decay
        } else if (idleFor > 1800) {
          rotY += auto * dt;
        }
      }

      const dark = isDark();

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      // Sphere base tint (the CSS glass overlay underneath carries the gloss)
      const base = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.1, cx, cy, R);
      if (dark) {
        base.addColorStop(0, "rgba(43, 210, 74, 0.2)");
        base.addColorStop(0.58, "rgba(63, 208, 227, 0.12)");
        base.addColorStop(1, "rgba(12, 30, 25, 0.22)");
      } else {
        base.addColorStop(0, "rgba(235, 255, 242, 0.48)");
        base.addColorStop(0.58, "rgba(31, 182, 201, 0.18)");
        base.addColorStop(1, "rgba(33, 111, 112, 0.13)");
      }
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.fillStyle = base;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = dark ? "rgba(239,236,226,0.3)" : "rgba(20,55,43,0.28)";
      ctx.stroke();

      // Land dots (front hemisphere only, brightness by depth)
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
        const py = cy - y * R;
        if (py < -6 || py > height + 6) continue; // skip dots cropped by the wrapper
        const alpha = 0.46 + 0.5 * z;
        const size = (1 + 1.05 * z) * (R / 300);
        ctx.beginPath();
        ctx.arc(cx + x * R, py, size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${dotBase},${alpha.toFixed(3)})`;
        ctx.fill();
      }

      // Glass rim light — a bright arc along the upper-left edge.
      ctx.beginPath();
      ctx.arc(cx, cy, R - 1.5, Math.PI * 0.85, Math.PI * 1.62);
      ctx.strokeStyle = dark ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.75)";
      ctx.lineWidth = 2.5;
      ctx.lineCap = "round";
      ctx.stroke();

      // Marker pings on canvas + reposition the HTML buttons
      for (const country of HOME_COUNTRIES) {
        const p = project(country.lat, country.lng);
        const btn = markerRefs.current.get(country.code);
        const px = cx + p.x * R;
        const py = cy - p.y * R;

        if (p.z > 0.05) {
          const pulse = ((now / 1400) % 1 + (country.code === "tw" ? 0.33 : country.code === "us" ? 0.66 : 0)) % 1;
          ctx.beginPath();
          ctx.arc(px, py, 6 + pulse * 16, 0, Math.PI * 2);
          ctx.strokeStyle = dark
            ? `rgba(43,210,74,${(0.5 * (1 - pulse)).toFixed(3)})`
            : `rgba(0,185,0,${(0.45 * (1 - pulse)).toFixed(3)})`;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }

        if (btn) {
          const visible = p.z > 0.08;
          // Anchor the pin dot on the projected point with the label floating
          // above it, so labels never clip against the cropped lower limb.
          btn.style.transform = `translate3d(${px.toFixed(1)}px, ${py.toFixed(1)}px, 0) translate(-50%, -100%) translateY(8px) scale(${(0.82 + 0.26 * Math.max(0, p.z)).toFixed(3)})`;
          btn.style.opacity = visible ? "1" : "0";
          btn.style.pointerEvents = visible ? "auto" : "none";
          btn.style.zIndex = visible ? "5" : "0";
        }
      }

      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    // Drag to spin (canvas only; marker buttons keep their own pointer events).
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
      rotY += dx * 0.005;
      tilt = Math.max(0.05, Math.min(0.6, tilt + dy * 0.004));
      const dtMs = Math.max(1, nowT - lastPointer.t);
      velY = (dx * 0.005) / (dtMs / 1000);
      velY = Math.max(-1.4, Math.min(1.4, velY));
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
  }, []);

  return (
    <div
      id="home-globe"
      ref={wrapRef}
      className="relative mx-auto h-[420px] w-full cursor-grab touch-none select-none overflow-hidden active:cursor-grabbing"
      style={{ height: "clamp(380px, calc(100svh - 300px), 820px)" }}
    >
      {/* Frosted glass sphere — sized/positioned by the canvas resize handler
          so it always hugs the projected globe exactly. */}
      <div
        id="home-globe-glass"
        ref={glassRef}
        aria-hidden
        className="pointer-events-none absolute rounded-full border border-white/35 bg-[radial-gradient(circle_at_32%_26%,rgba(255,255,255,0.36),rgba(255,255,255,0.10)_38%,rgba(255,255,255,0.03)_58%,rgba(255,255,255,0.015)_78%)] shadow-[inset_0_1px_1px_rgba(255,255,255,0.55),inset_0_-30px_70px_rgba(20,60,30,0.07),0_50px_140px_-50px_rgba(0,110,55,0.45)] backdrop-blur-[7px] backdrop-saturate-150 dark:border-white/15 dark:bg-[radial-gradient(circle_at_32%_26%,rgba(255,255,255,0.13),rgba(255,255,255,0.04)_40%,rgba(255,255,255,0.01)_60%,transparent_78%)] dark:shadow-[inset_0_1px_1px_rgba(255,255,255,0.18),0_50px_140px_-50px_rgba(43,210,74,0.35)]"
      />

      <canvas id="home-globe-canvas" ref={canvasRef} className="absolute inset-0" aria-hidden />

      {/* Horizon fade — blends the cropped lower limb into the page surface. */}
      <div
        id="home-globe-fade"
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 z-[4] h-[20%] bg-gradient-to-t from-[var(--surface-base)] to-transparent"
      />

      {HOME_COUNTRIES.map((country) => {
        const isSelected = selected === country.code;
        return (
          <button
            key={country.code}
            id={`home-globe-marker-${country.code}`}
            ref={(el) => {
              if (el) markerRefs.current.set(country.code, el);
              else markerRefs.current.delete(country.code);
            }}
            type="button"
            onClick={() => onSelect(country.code)}
            aria-label={locale === "zh-TW" ? `選擇${country.nameZh}` : `Choose ${country.name}`}
            className="group absolute left-0 top-0 flex flex-col items-center gap-1.5 outline-none transition-opacity duration-200"
            style={{ opacity: 0, pointerEvents: "none" }}
          >
            <span
              id={`home-globe-marker-label-${country.code}`}
              className="surface-glass flex items-center gap-1.5 whitespace-nowrap rounded-full border border-[var(--border-hairline)] px-3 py-1.5 text-[13px] font-semibold shadow-[var(--shadow-raise)] transition-transform duration-200 group-hover:-translate-y-0.5"
            >
              <span id={`home-globe-marker-flag-${country.code}`} aria-hidden>{country.flag}</span>
              {locale === "zh-TW" ? country.nameZh : country.name}
            </span>
            <span
              id={`home-globe-marker-dot-${country.code}`}
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

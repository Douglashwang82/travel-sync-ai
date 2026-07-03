'use client'

// ─────────────────────────────────────────────────────────────────────────────
// EarthScene — phases 1 + 2 of the index-page survey pipeline on ONE canvas.
//
// A single dependency-free dotted earth serves both steps: the world view with
// country markers, and — after a pick — the same camera diving into that
// country's cities. Because the earth object persists across the two phases,
// nothing is handed off or re-mounted mid-motion; only the marks change
// (country pins dissolve out, city pins bloom in). Deselecting the country
// zooms the identical camera back out to the world.
//
// Continents are rasterized into a dot matrix (point-in-polygon over coarse
// landmass outlines, sampled with cos(lat) spacing so density is even on the
// sphere) and orthographically projected. Markers are HTML buttons repositioned
// every frame so they stay accessible (focusable, labelled) while tracking the
// camera. Drag to spin; auto-rotation pauses on interaction and under
// prefers-reduced-motion.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { easeConfirm } from "@/components/motion/variants";
import { HOME_COUNTRIES, getHomeCities, type HomeCity, type HomeCountry, type HomeCountryCode } from "@/lib/home-survey";

type LngLat = [number, number];

const TAU = Math.PI * 2;

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

const landDotsCache = new Map<number, LandDot[]>();

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

function buildLandDots(latStep = 1.15): LandDot[] {
  const cached = landDotsCache.get(latStep);
  if (cached) return cached;
  const dots: LandDot[] = [];
  // Smaller steps are used at city zoom where the same geography spans more
  // pixels and needs extra texture to avoid looking sparse.
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
  landDotsCache.set(latStep, dots);
  return dots;
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function toDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function angularDelta(from: number, to: number): number {
  return ((((to - from + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
}

/** Mean position of a country's cities (circular mean for longitude). */
function focusCenter(cities: HomeCity[]): { lat: number; lng: number } {
  if (cities.length === 0) return { lat: 0, lng: 0 };
  let lat = 0;
  let sin = 0;
  let cos = 0;
  for (const city of cities) {
    lat += city.lat;
    const lng = toRad(city.lng);
    sin += Math.sin(lng);
    cos += Math.cos(lng);
  }
  return {
    lat: lat / cities.length,
    lng: toDeg(Math.atan2(sin / cities.length, cos / cities.length)),
  };
}

/** Radius that frames all of a country's cities once centred. */
function computeFocusRadius(
  cities: HomeCity[],
  baseR: number,
  width: number,
  height: number,
  projectAt: (lat: number, lng: number, rotY: number, tilt: number) => { x: number; y: number; z: number },
  rotY: number,
  tilt: number,
): number {
  if (cities.length <= 1) return Math.min(baseR * 2.4, Math.max(width, height) * 1.55);

  const projected = cities.map((city) => projectAt(city.lat, city.lng, rotY, tilt));
  const xs = projected.map((p) => p.x);
  const ys = projected.map((p) => p.y);
  const spreadX = Math.max(0.12, Math.max(...xs) - Math.min(...xs));
  const spreadY = Math.max(0.08, Math.max(...ys) - Math.min(...ys));
  const fitR = Math.min((width * 0.64) / spreadX, (height * 0.45) / spreadY);
  const floor = baseR * 1.55;
  const ceiling = Math.min(baseR * 3.45, Math.max(width, height) * 1.85);
  return Math.max(floor, Math.min(fitR, ceiling));
}

// One camera move covers the full world↔city travel in either direction.
const ZOOM_MS = 1000;
// Picking a city keeps the camera moving: it plunges toward that city while
// the section blur-exits above it, so the hand-off to the POI wall reads as
// one continuous dive instead of a fade from a standstill.
const PLUNGE_MS = 700;
const CITY_LAND_DOT_STEP = 0.62;
// City markers bloom in one after another once the camera settles.
const CITY_MARKER_DELAY_MS = 150;
const CITY_MARKER_STAGGER_MS = 80;
const CITY_MARKER_IN_S = 0.35;
const CITY_MARKER_OUT_S = 0.22;

interface EarthSceneProps {
  locale: "en" | "zh-TW";
  /** Non-null focuses the camera on this country's cities; null is the world view. */
  country: HomeCountry | null;
  /** City the user just clicked (drives the marker's selected ring). */
  selectedCity: string | null;
  onSelectCountry: (code: HomeCountryCode) => void;
  onSelectCity: (city: HomeCity) => void;
  onBack: () => void;
}

export default function EarthScene({ locale, country, selectedCity, onSelectCountry, onSelectCity, onBack }: EarthSceneProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const glassRef = useRef<HTMLDivElement | null>(null);
  const countryRefs = useRef<Map<HomeCountryCode, HTMLButtonElement>>(new Map());
  const cityRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const zh = locale === "zh-TW";

  // Keep the outgoing country's city markers mounted while the camera zooms
  // back out so they can fade instead of vanishing on the click frame.
  const [fadingCountry, setFadingCountry] = useState<HomeCountry | null>(null);
  const [prevCountry, setPrevCountry] = useState<HomeCountry | null>(country);
  if (prevCountry !== country) {
    setPrevCountry(country);
    if (prevCountry && !country) setFadingCountry(prevCountry);
  }
  useEffect(() => {
    if (country) return;
    const timer = window.setTimeout(() => setFadingCountry(null), ZOOM_MS + 200);
    return () => window.clearTimeout(timer);
  }, [country]);

  const markerCountry = country ?? fadingCountry;
  const cities = useMemo(() => (markerCountry ? getHomeCities(markerCountry.code) : []), [markerCountry]);
  const markerOffsets = useMemo(
    () => new Map(cities.map((city, index) => [city.id, markerOffset(city, index, cities)])),
    [cities],
  );

  // The RAF loop reads these refs so the single earth persists across focus
  // changes instead of the effect (and its camera state) being rebuilt.
  const desiredFocusRef = useRef<HomeCountryCode | null>(country?.code ?? null);
  useEffect(() => {
    desiredFocusRef.current = country?.code ?? null;
  }, [country]);
  const citiesRef = useRef<HomeCity[]>(cities);
  const offsetsRef = useRef(markerOffsets);
  useEffect(() => {
    citiesRef.current = cities;
    offsetsRef.current = markerOffsets;
  }, [cities, markerOffsets]);
  // Set by the city buttons' onClick; the RAF loop picks it up on the next
  // frame and dives the camera toward the clicked city as the scene exits.
  const plungeRef = useRef<{ lat: number; lng: number; start: number; from?: { rotY: number; tilt: number; R: number } } | null>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const coarseDots = buildLandDots();
    const fineDots = buildLandDots(CITY_LAND_DOT_STEP);
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Tailwind's dark variant and the page tokens are class-driven. Following
    // the OS preference here would paint white land over an otherwise light UI.
    const isDark = () => document.documentElement.classList.contains("dark");

    // Camera state — owned by the RAF loop. `k` blends the world look (0) into
    // the city-focus look (1): dot texture, tint and marker sets all follow it.
    let rotY = (-138 * Math.PI) / 180; // start with East Asia facing the viewer
    let tilt = 0.26;
    let R = 0;
    let cy = 0;
    let k = 0;
    let focusCode: HomeCountryCode | null = null;
    let focusTarget: { rotY: number; tilt: number; R: number } | null = null;
    let tween:
      | {
          start: number;
          dur: number;
          from: { rotY: number; tilt: number; R: number; cy: number; k: number };
          to: { rotY: number; tilt: number; R: number; cy: number; k: number };
        }
      | null = null;
    let settledAt: number | null = null;
    // Per-city marker intro progress (0..1), accumulated per frame so entries
    // stagger in at focus and anything mid-bloom fades back out on zoom-out.
    const cityIn = new Map<string, number>();

    let velY = 0;
    let dragging = false;
    let lastPointer: { x: number; y: number; t: number } | null = null;
    let lastInteraction = 0;
    let raf = 0;
    let width = 0;
    let height = 0;
    let dpr = 1;
    let cx = 0;
    let worldR = 0;
    let worldCy = 0;
    let glassR = -1;
    let glassCy = -1;

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
    const project = (lat: number, lng: number) => projectAt(lat, lng, rotY, tilt);

    const resolveFocusTarget = (code: HomeCountryCode) => {
      const focusCities = getHomeCities(code);
      const focus = focusCenter(focusCities);
      const targetRotY = -toRad(focus.lng);
      const targetTilt = clamp(toRad(focus.lat), -0.72, 0.72);
      return {
        rotY: targetRotY,
        tilt: targetTilt,
        R: computeFocusRadius(focusCities, worldR, width, height, projectAt, targetRotY, targetTilt),
      };
    };

    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      width = wrap.clientWidth;
      height = wrap.clientHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      // The sphere targets 90% of the stage width, then grows on narrow/tall
      // screens so the lower edge reaches the fold instead of leaving a blank band.
      worldR = Math.min(Math.max(width * 0.45, (height - 24) / 2), width * 1.35, height * 1.1);
      cx = width / 2;
      worldCy = height >= 2 * worldR + 48 ? height - worldR : 24 + worldR;

      if (focusCode) focusTarget = resolveFocusTarget(focusCode);
      if (tween) {
        tween.to = focusTarget
          ? { rotY: focusTarget.rotY, tilt: focusTarget.tilt, R: focusTarget.R, cy: height * 0.54, k: 1 }
          : { rotY: tween.to.rotY, tilt: 0.26, R: worldR, cy: worldCy, k: 0 };
      } else if (focusTarget) {
        R = focusTarget.R;
        cy = height * 0.54;
      } else {
        R = worldR;
        cy = worldCy;
      }
    };
    resize();

    // First frame: land directly in whatever state the parent mounted us with
    // (world view, or already at focus when returning from a later phase).
    focusCode = desiredFocusRef.current;
    if (focusCode) {
      focusTarget = resolveFocusTarget(focusCode);
      rotY = focusTarget.rotY;
      tilt = focusTarget.tilt;
      R = focusTarget.R;
      cy = height * 0.54;
      k = 1;
      settledAt = performance.now();
    }

    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    const startTween = (now: number) => {
      const from = { rotY, tilt, R, cy, k };
      if (focusCode) {
        focusTarget = resolveFocusTarget(focusCode);
        tween = {
          start: now,
          dur: reduceMotion ? 1 : ZOOM_MS,
          from,
          to: { rotY: focusTarget.rotY, tilt: focusTarget.tilt, R: focusTarget.R, cy: height * 0.54, k: 1 },
        };
      } else {
        // Zoom back out where we are — keep the longitude so the user still
        // sees the country they just left, just from world altitude.
        focusTarget = null;
        tween = {
          start: now,
          dur: reduceMotion ? 1 : ZOOM_MS,
          from,
          to: { rotY, tilt: 0.26, R: worldR, cy: worldCy, k: 0 },
        };
      }
      settledAt = null;
      velY = 0;
      dragging = false;
      lastPointer = null;
    };

    let lastTime = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(64, now - lastTime) / 1000;
      lastTime = now;

      // A focus change from React (country picked / cleared) retargets the
      // same camera — the dive and the zoom-out are one tween each way.
      if (desiredFocusRef.current !== focusCode) {
        focusCode = desiredFocusRef.current;
        startTween(now);
      }

      const plunge = reduceMotion ? null : plungeRef.current;
      if (plunge) {
        // City picked: keep flying — centre the city and push the camera in.
        // The section is blur-exiting above this, so it only has to look right
        // for the first few hundred milliseconds.
        const from = plunge.from ?? (plunge.from = { rotY, tilt, R });
        const t = clamp((now - plunge.start) / PLUNGE_MS, 0, 1);
        const e = easeInOutCubic(t);
        const targetRotY = -toRad(plunge.lng);
        const targetTilt = clamp(toRad(plunge.lat), -0.72, 0.72);
        rotY = from.rotY + angularDelta(from.rotY, targetRotY) * e;
        tilt = from.tilt + (targetTilt - from.tilt) * e;
        R = from.R * (1 + 1.15 * e);
      } else if (tween) {
        const t = clamp((now - tween.start) / tween.dur, 0, 1);
        const e = easeInOutCubic(t);
        rotY = tween.from.rotY + angularDelta(tween.from.rotY, tween.to.rotY) * e;
        tilt = tween.from.tilt + (tween.to.tilt - tween.from.tilt) * e;
        R = tween.from.R + (tween.to.R - tween.from.R) * e;
        cy = tween.from.cy + (tween.to.cy - tween.from.cy) * e;
        k = tween.from.k + (tween.to.k - tween.from.k) * e;
        if (t >= 1) {
          tween = null;
          if (k >= 0.999) settledAt = now;
        }
      } else if (!dragging) {
        if (k <= 0.001) {
          // World idle: auto-rotate, carrying drag inertia with decay.
          const idleFor = now - lastInteraction;
          const auto = reduceMotion ? 0 : 0.07;
          if (Math.abs(velY) > 0.0001) {
            rotY += velY * dt;
            velY *= Math.pow(0.04, dt); // strong decay
          } else if (idleFor > 1800) {
            rotY += auto * dt;
          }
        } else if (focusTarget) {
          // Focus idle: spring gently back onto the city framing.
          R = focusTarget.R;
          if (Math.abs(velY) > 0.0001) {
            rotY += velY * dt;
            velY *= Math.pow(0.045, dt);
          } else if (now - lastInteraction > 1400) {
            rotY += angularDelta(rotY, focusTarget.rotY) * Math.min(1, dt * 1.35);
            tilt += (focusTarget.tilt - tilt) * Math.min(1, dt * 1.35);
          }
        }
      }

      // Glass overlay hugs the sphere; only touch the DOM when it moved.
      if (Math.abs(R - glassR) > 0.1 || Math.abs(cy - glassCy) > 0.1) {
        glassR = R;
        glassCy = cy;
        const glass = glassRef.current;
        if (glass) {
          glass.style.left = `${cx - R}px`;
          glass.style.top = `${cy - R}px`;
          glass.style.width = `${2 * R}px`;
          glass.style.height = `${2 * R}px`;
        }
      }

      const dark = isDark();
      const mix = (from: number, to: number) => from + (to - from) * k;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      // Sphere base tint (the CSS glass overlay underneath carries the gloss)
      const base = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.1, cx, cy, R);
      if (dark) {
        base.addColorStop(0, `rgba(43, 210, 74, ${mix(0.2, 0.22).toFixed(3)})`);
        base.addColorStop(0.58, `rgba(63, 208, 227, ${mix(0.12, 0.13).toFixed(3)})`);
        base.addColorStop(1, `rgba(12, 30, 25, ${mix(0.22, 0.24).toFixed(3)})`);
      } else {
        base.addColorStop(0, `rgba(235, 255, 242, ${mix(0.48, 0.52).toFixed(3)})`);
        base.addColorStop(0.58, `rgba(31, 182, 201, ${mix(0.18, 0.2).toFixed(3)})`);
        base.addColorStop(1, `rgba(33, 111, 112, ${mix(0.13, 0.14).toFixed(3)})`);
      }
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, TAU);
      ctx.fillStyle = base;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = dark
        ? `rgba(239,236,226,${mix(0.3, 0.28).toFixed(3)})`
        : `rgba(20,55,43,${mix(0.28, 0.26).toFixed(3)})`;
      ctx.stroke();

      // Land dots: the coarse world texture dissolves into the finer city one
      // as the camera travels, so the surface never re-renders in a pop.
      const dotBase = dark ? "232,246,235" : "18,48,38";
      const cosTilt = Math.cos(tilt);
      const sinTilt = Math.sin(tilt);
      const drawDots = (set: LandDot[], sizeA: number, sizeB: number, sizeDiv: number, alphaA: number, fade: number) => {
        if (fade <= 0.004) return;
        for (const d of set) {
          const lam = d.lambda + rotY;
          const x = d.cosPhi * Math.sin(lam);
          const z0 = d.cosPhi * Math.cos(lam);
          const y = d.sinPhi * cosTilt - z0 * sinTilt;
          const z = d.sinPhi * sinTilt + z0 * cosTilt;
          if (z <= 0) continue;
          const px = cx + x * R;
          const py = cy - y * R;
          if (px < -12 || px > width + 12 || py < -12 || py > height + 12) continue;
          const alpha = (alphaA + 0.5 * z) * fade;
          const size = (sizeA + sizeB * z) * (R / sizeDiv);
          ctx.beginPath();
          ctx.arc(px, py, size, 0, TAU);
          ctx.fillStyle = `rgba(${dotBase},${alpha.toFixed(3)})`;
          ctx.fill();
        }
      };
      drawDots(coarseDots, 0.58, 0.68, 360, 0.46, 1 - k);
      drawDots(fineDots, 0.45, 0.52, 420, 0.42, k);

      // Glass rim light — a bright arc along the upper-left edge.
      ctx.beginPath();
      ctx.arc(cx, cy, R - 1.5, Math.PI * 0.85, Math.PI * 1.62);
      ctx.strokeStyle = dark
        ? `rgba(255,255,255,${mix(0.22, 0.2).toFixed(3)})`
        : `rgba(255,255,255,${mix(0.75, 0.72).toFixed(3)})`;
      ctx.lineWidth = 2.5;
      ctx.lineCap = "round";
      ctx.stroke();

      // ── Country marks: fade with the camera travel (visible at world view).
      const countryFade = 1 - k;
      for (const c of HOME_COUNTRIES) {
        const p = project(c.lat, c.lng);
        const btn = countryRefs.current.get(c.code);
        const px = cx + p.x * R;
        const py = cy - p.y * R;

        if (p.z > 0.05 && countryFade > 0.02) {
          const pulse = ((now / 1400) % 1 + (c.code === "tw" ? 0.33 : c.code === "us" ? 0.66 : 0)) % 1;
          ctx.beginPath();
          ctx.arc(px, py, 6 + pulse * 16, 0, TAU);
          ctx.strokeStyle = dark
            ? `rgba(43,210,74,${(0.5 * (1 - pulse) * countryFade).toFixed(3)})`
            : `rgba(0,185,0,${(0.45 * (1 - pulse) * countryFade).toFixed(3)})`;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }

        if (btn) {
          const visible = p.z > 0.08 && countryFade > 0.01;
          // Anchor the pin dot on the projected point with the label floating
          // above it, so labels never clip against the cropped lower limb.
          btn.style.transform = `translate3d(${px.toFixed(1)}px, ${py.toFixed(1)}px, 0) translate(-50%, -100%) translateY(8px) scale(${(0.82 + 0.26 * Math.max(0, p.z)).toFixed(3)})`;
          btn.style.opacity = visible ? countryFade.toFixed(3) : "0";
          btn.style.pointerEvents = visible && countryFade > 0.5 ? "auto" : "none";
          btn.style.zIndex = visible ? "5" : "0";
        }
      }

      // ── City marks: bloom in staggered once the camera settles at focus,
      //    fade back out as it leaves.
      const activeCities = citiesRef.current;
      activeCities.forEach((city, index) => {
        const p = project(city.lat, city.lng);
        const btn = cityRefs.current.get(city.id);
        const offset = offsetsRef.current.get(city.id) ?? { x: 0, y: 0 };
        const markerX = cx + p.x * R + offset.x;
        const markerY = cy - p.y * R + offset.y;
        const visible = p.z > 0.06 && markerX > -160 && markerX < width + 160 && markerY > -160 && markerY < height + 160;

        let v = cityIn.get(city.id) ?? 0;
        if (reduceMotion) {
          v = k >= 0.999 ? 1 : 0;
        } else if (plunge) {
          // Falling past the camera as it dives into the picked city.
          v = Math.max(0, v - dt / 0.18);
        } else if (k >= 0.999 && settledAt != null) {
          if (now - settledAt >= CITY_MARKER_DELAY_MS + index * CITY_MARKER_STAGGER_MS) {
            v = Math.min(1, v + dt / CITY_MARKER_IN_S);
          }
        } else {
          v = Math.max(0, v - dt / CITY_MARKER_OUT_S);
        }
        cityIn.set(city.id, v);
        const bloom = easeOutCubic(v);

        if (p.z > 0.04 && bloom > 0.02) {
          const pulse = ((now / 1400) % 1 + index / Math.max(1, activeCities.length)) % 1;
          ctx.beginPath();
          ctx.arc(markerX, markerY, 6 + pulse * 16, 0, TAU);
          ctx.strokeStyle = dark
            ? `rgba(43,210,74,${(0.5 * (1 - pulse) * bloom).toFixed(3)})`
            : `rgba(0,185,0,${(0.45 * (1 - pulse) * bloom).toFixed(3)})`;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }

        if (btn) {
          const rise = 8 + (1 - bloom) * 10;
          btn.style.transform = `translate3d(${markerX.toFixed(1)}px, ${markerY.toFixed(1)}px, 0) translate(-50%, -100%) translateY(${rise.toFixed(1)}px) scale(${(0.9 + 0.18 * Math.max(0, p.z)).toFixed(3)})`;
          btn.style.opacity = visible ? bloom.toFixed(3) : "0";
          btn.style.pointerEvents = visible && bloom > 0.6 ? "auto" : "none";
          btn.style.zIndex = visible ? "6" : "0";
        }
      });

      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    // Drag to spin (canvas only; marker buttons keep their own pointer events).
    const onPointerDown = (e: PointerEvent) => {
      if (tween || plungeRef.current) return; // no steering mid-dive
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
      if (k > 0.5) {
        // Focused: slower, latitude-clamped steering around the cities.
        rotY += dx * 0.0028;
        tilt = clamp(tilt + dy * 0.0024, -0.72, 0.72);
        const dtMs = Math.max(1, nowT - lastPointer.t);
        velY = clamp((dx * 0.0028) / (dtMs / 1000), -1, 1);
      } else {
        rotY += dx * 0.005;
        tilt = clamp(tilt + dy * 0.004, 0.05, 0.6);
        const dtMs = Math.max(1, nowT - lastPointer.t);
        velY = clamp((dx * 0.005) / (dtMs / 1000), -1.4, 1.4);
      }
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
      id="home-earth"
      ref={wrapRef}
      className="relative mx-auto h-full min-h-[420px] w-full flex-1 cursor-grab touch-none select-none overflow-hidden active:cursor-grabbing"
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex justify-center px-5 pt-2 sm:pt-4">
        <AnimatePresence>
          {country && (
            <motion.button
              key="back"
              id="home-city-back"
              type="button"
              onClick={onBack}
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0, transition: { delay: 0.7, duration: 0.4, ease: easeConfirm } }}
              exit={{ opacity: 0, y: -8, transition: { duration: 0.25, ease: easeConfirm } }}
              className="surface-glass pointer-events-auto inline-flex h-9 items-center gap-1 rounded-full border border-[var(--border-hairline)] px-3.5 text-[13px] font-semibold text-[var(--text-muted)] shadow-[var(--shadow-raise)] transition hover:text-[var(--text-primary)]"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden />
              {zh ? "重選國家" : "Change country"}
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      {/* Frosted glass sphere — sized/positioned by the RAF loop so it always
          hugs the projected globe exactly, at every zoom level. */}
      <div
        id="home-earth-glass"
        ref={glassRef}
        aria-hidden
        className="pointer-events-none absolute rounded-full border border-white/35 bg-[radial-gradient(circle_at_32%_26%,rgba(255,255,255,0.36),rgba(255,255,255,0.10)_38%,rgba(255,255,255,0.03)_58%,rgba(255,255,255,0.015)_78%)] shadow-[inset_0_1px_1px_rgba(255,255,255,0.55),inset_0_-30px_70px_rgba(20,60,30,0.07),0_50px_140px_-50px_rgba(0,110,55,0.45)] backdrop-blur-[7px] backdrop-saturate-150 dark:border-white/15 dark:bg-[radial-gradient(circle_at_32%_26%,rgba(255,255,255,0.13),rgba(255,255,255,0.04)_40%,rgba(255,255,255,0.01)_60%,transparent_78%)] dark:shadow-[inset_0_1px_1px_rgba(255,255,255,0.18),0_50px_140px_-50px_rgba(43,210,74,0.35)]"
      />

      <canvas id="home-earth-canvas" ref={canvasRef} className="absolute inset-0" aria-hidden />

      {HOME_COUNTRIES.map((c) => {
        const isSelected = country?.code === c.code;
        return (
          <button
            key={c.code}
            id={`home-globe-marker-${c.code}`}
            ref={(el) => {
              if (el) countryRefs.current.set(c.code, el);
              else countryRefs.current.delete(c.code);
            }}
            type="button"
            onClick={() => onSelectCountry(c.code)}
            aria-label={zh ? `選擇${c.nameZh}` : `Choose ${c.name}`}
            className="group absolute left-0 top-0 flex flex-col items-center gap-1.5 outline-none transition-opacity duration-200"
            style={{ opacity: 0, pointerEvents: "none" }}
          >
            <span
              id={`home-globe-marker-label-${c.code}`}
              className="surface-glass flex items-center gap-1.5 whitespace-nowrap rounded-full border border-[var(--border-hairline)] px-3 py-1.5 text-[13px] font-semibold shadow-[var(--shadow-raise)] transition-transform duration-200 group-hover:-translate-y-0.5"
            >
              <span id={`home-globe-marker-flag-${c.code}`} aria-hidden>{c.flag}</span>
              {zh ? c.nameZh : c.name}
            </span>
            <span
              id={`home-globe-marker-dot-${c.code}`}
              className={`grid h-4 w-4 place-items-center rounded-full border-2 border-white bg-[var(--accent-line)] shadow-[0_0_0_4px_color-mix(in_oklab,var(--accent-line)_25%,transparent)] transition-transform duration-200 group-hover:scale-125 group-focus-visible:scale-125 dark:border-[#16170f] ${
                isSelected ? "scale-150" : ""
              }`}
            />
          </button>
        );
      })}

      {markerCountry &&
        cities.map((city) => {
          const isSelected = selectedCity === city.name;
          return (
            <button
              key={city.id}
              id={`home-city-marker-${city.id}`}
              ref={(el) => {
                if (el) cityRefs.current.set(city.id, el);
                else cityRefs.current.delete(city.id);
              }}
              type="button"
              onClick={() => {
                plungeRef.current = { lat: city.lat, lng: city.lng, start: performance.now() };
                onSelectCity(city);
              }}
              aria-label={zh ? `選擇${city.nameZh}` : `Choose ${city.name}`}
              className="group absolute left-0 top-0 flex flex-col items-center gap-1.5 outline-none transition-opacity duration-200"
              style={{ opacity: 0, pointerEvents: "none" }}
            >
              <span aria-hidden>
                <span
                  id={`home-city-marker-label-${city.id}`}
                  className="surface-glass flex items-center gap-1.5 whitespace-nowrap rounded-full border border-[var(--border-hairline)] px-3 py-1.5 text-[13px] font-semibold shadow-[var(--shadow-raise)] transition-transform duration-200 group-hover:-translate-y-0.5"
                >
                  <span id={`home-city-marker-flag-${city.id}`}>{markerCountry.flag}</span>
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

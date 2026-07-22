'use client'

// ─────────────────────────────────────────────────────────────────────────────
// Index page — a single interactive survey pipeline, nothing else.
//
//   globe      → spinning dotted earth; pick a country marker
//   cities     → zoomed earth; pick an available city marker
//   dates      → seasonality-aware calendar; pick the travel window
//   pois       → that city's POIs take the stage as a media wall
//   reasoning  → the AI agent visibly plans (SSE from /api/home/itinerary)
//   itinerary  → animated map + dated, timed, costed plan
//
// The globe and cities phases share ONE persistent earth canvas (EarthScene):
// the camera dives in/out on the same object and only the marks change. Later
// scene hand-offs are choreographed with AnimatePresence (scale + blur
// cross-morphs). The hero line at the top-middle re-types itself per phase.
// Bilingual (EN / zh-TW) with the locale persisted under the same key the old
// page used.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { Languages } from "lucide-react";
import EarthScene from "@/components/home/earth-scene";
import DatesScene, { type HomeDateRange } from "@/components/home/dates-scene";
import PoiScene from "@/components/home/poi-scene";
import ReasoningScene from "@/components/home/reasoning-scene";
import ItineraryScene from "@/components/home/itinerary-scene";
import { easeConfirm } from "@/components/motion/variants";
import { isoDiffDays } from "@/lib/home-seasons";
import {
  getHomeCity,
  getHomeCountry,
  type HomeCity,
  type HomeCountryCode,
  type HomeItinerary,
  type HomePoi,
} from "@/lib/home-survey";

type Locale = "en" | "zh-TW";
type Phase = "globe" | "cities" | "dates" | "pois" | "reasoning" | "itinerary";

const LANGUAGE_STORAGE_KEY = "travelsync-home-locale";
const PHASE_ORDER: Phase[] = ["globe", "cities", "dates", "pois", "reasoning", "itinerary"];
const GLOBE_QUESTION_ROTATE_MS = 2600;

const GLOBE_ROTATING_QUESTIONS: Record<Locale, string[]> = {
  en: [
    "Where do you want to go?",
    "When do you want to go?",
    "What kind of trip are you dreaming of?",
  ],
  "zh-TW": ["你想去哪裡？", "你想什麼時候出發？", "你想要哪一種旅行體驗？"],
};

const COPY = {
  en: {
    brand: "TravelSync AI",
    logIn: "Log in",
    languageLabel: "Language",
    steps: ["Destination", "City", "Dates", "Spots", "AI plan", "Itinerary"],
    globeTitle: "Where do you want to go?",
    globeSub: "Spin the globe — tap a marker to begin.",
    citiesTitle: "Which city should we zoom into?",
    citiesSub: (name: string) => `Available cities in ${name}.`,
    datesTitle: "When do you want to go?",
    datesSub: (name: string) => `Weather, crowds, prices and festivals in ${name} — all in view.`,
    poisTitle: "What catches your eye?",
    poisSub: (name: string) => `Tap everything you'd love to see in ${name}.`,
    reasoningTitle: "Your AI agent is planning…",
    reasoningSub: "Clustering, planning, routing and costing — live.",
    itinerarySub: "",
  },
  "zh-TW": {
    brand: "TravelSync AI",
    logIn: "登入",
    languageLabel: "語言",
    steps: ["目的地", "城市", "日期", "景點", "AI 規劃", "行程"],
    globeTitle: "你想去哪裡？",
    globeSub: "轉動地球，點選圖釘開始。",
    citiesTitle: "想先放大哪座城市？",
    citiesSub: (name: string) => `${name}目前可選的城市。`,
    datesTitle: "你想什麼時候出發？",
    datesSub: (name: string) => `${name}的天氣、人潮、價格與節慶，一次看清楚。`,
    poisTitle: "哪些地方吸引你？",
    poisSub: (name: string) => `點選所有你想在${name}造訪的地方。`,
    reasoningTitle: "AI 旅遊代理規劃中…",
    reasoningSub: "分群、規劃、排程與估價，全程直播。",
    itinerarySub: "",
  },
} satisfies Record<Locale, Record<string, unknown>>;

export default function HomePageClient() {
  const [locale, setLocale] = useState<Locale>("zh-TW");
  const [phase, setPhase] = useState<Phase>("globe");
  const [globeQuestionIndex, setGlobeQuestionIndex] = useState(0);
  const [country, setCountry] = useState<HomeCountryCode | null>(null);
  const [cityName, setCityName] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<HomeDateRange | null>(null);
  const [selectedPoiIds, setSelectedPoiIds] = useState<ReadonlySet<string>>(new Set());
  const [trendingPois, setTrendingPois] = useState<HomePoi[]>([]);
  const [itinerary, setItinerary] = useState<HomeItinerary | null>(null);

  const copy = COPY[locale];
  const zh = locale === "zh-TW";
  const activeCountry = country ? getHomeCountry(country) : null;
  const activeCity = activeCountry && cityName ? getHomeCity(activeCountry.code, cityName) : null;

  // Hydrate persisted locale after mount (avoids SSR mismatch).
  useEffect(() => {
    const saved = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (saved === "en" || saved === "zh-TW") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLocale(saved);
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, locale);
  }, [locale]);

  useEffect(() => {
    if (phase !== "globe") return;

    const questions = GLOBE_ROTATING_QUESTIONS[locale];
    if (questions.length <= 1) return;

    const timer = window.setInterval(() => {
      setGlobeQuestionIndex((prev) => (prev + 1) % questions.length);
    }, GLOBE_QUESTION_ROTATE_MS);

    return () => window.clearInterval(timer);
  }, [phase, locale]);

  // Warm the live trending cards as soon as a city is picked (during the
  // dates phase) so the POI wall arrives already merged. Fire-and-forget:
  // any failure just leaves the static catalog, which is the baseline anyway.
  useEffect(() => {
    // Selection handlers reset trendingPois; this effect only fetches.
    if (!country || !cityName) return;
    const ctrl = new AbortController();
    fetch(
      `/api/home/trending-pois?country=${country}&city=${encodeURIComponent(cityName)}`,
      { signal: ctrl.signal },
    )
      .then((res) => (res.ok ? res.json() : { pois: [] }))
      .then((data: { pois?: HomePoi[] }) => setTrendingPois(Array.isArray(data.pois) ? data.pois : []))
      .catch(() => {
        // Aborted fetches (city changed) must not clobber the newer request's state.
        if (!ctrl.signal.aborted) setTrendingPois([]);
      });
    return () => ctrl.abort();
  }, [country, cityName]);

  const handleLocaleChange = useCallback((nextLocale: Locale) => {
    setLocale(nextLocale);
    setGlobeQuestionIndex(0);
  }, []);

  const handleCountrySelect = useCallback((code: HomeCountryCode) => {
    setCountry(code);
    setCityName(null);
    setDateRange(null);
    setSelectedPoiIds(new Set());
    setTrendingPois([]);
    // EarthScene stays mounted and dives its own camera; no hand-off delay.
    setPhase("cities");
  }, []);

  const handleCitySelect = useCallback((city: HomeCity) => {
    setCityName(city.name);
    setSelectedPoiIds(new Set());
    setTrendingPois([]);
    setPhase("dates");
  }, []);

  const handleDatesConfirm = useCallback((range: HomeDateRange) => {
    setDateRange(range);
    setPhase("pois");
  }, []);

  const togglePoi = useCallback((id: string) => {
    setSelectedPoiIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const restart = useCallback(() => {
    setItinerary(null);
    setSelectedPoiIds(new Set());
    setTrendingPois([]);
    setDateRange(null);
    setCountry(null);
    setCityName(null);
    setGlobeQuestionIndex(0);
    setPhase("globe");
  }, []);

  const goToPhase = useCallback(
    (target: Phase) => {
      // The rail only travels backwards: forward progress comes from the scenes.
      if (PHASE_ORDER.indexOf(target) >= PHASE_ORDER.indexOf(phase)) return;
      if (target === "globe") restart();
      else if (target === "cities" && country) {
        setItinerary(null);
        setSelectedPoiIds(new Set());
        setPhase("cities");
      } else if (target === "dates" && country && cityName) {
        // Picks survive a date rethink; only the generated plan is stale.
        setItinerary(null);
        setPhase("dates");
      } else if (target === "pois" && country && cityName && dateRange) {
        setItinerary(null);
        setPhase("pois");
      }
    },
    [phase, country, cityName, dateRange, restart],
  );

  const heroTitle =
    phase === "globe"
      ? (GLOBE_ROTATING_QUESTIONS[locale][globeQuestionIndex] ?? copy.globeTitle)
      : phase === "cities"
        ? copy.citiesTitle
      : phase === "dates"
        ? copy.datesTitle
      : phase === "pois"
        ? copy.poisTitle
        : phase === "reasoning"
          ? copy.reasoningTitle
          : itinerary?.title ?? "";
  const heroSub =
    phase === "globe"
      ? copy.globeSub
      : phase === "cities" && activeCountry
        ? copy.citiesSub(zh ? activeCountry.nameZh : activeCountry.name)
      : phase === "dates" && activeCity
        ? copy.datesSub(zh ? activeCity.nameZh : activeCity.name)
      : phase === "pois" && activeCity
        ? copy.poisSub(zh ? activeCity.nameZh : activeCity.name)
      : phase === "reasoning"
        ? copy.reasoningSub
          : "";

  return (
    <div id="home-root" className="relative min-h-screen overflow-x-clip bg-[var(--surface-base)] text-[var(--text-primary)] antialiased selection:bg-[var(--accent-line)] selection:text-white">

      {/* ─── Minimal header ─────────────────────────────────────────────── */}
      <header id="home-header" className="surface-glass fixed inset-x-0 top-0 z-50">
        <div id="home-header-inner" className="mx-auto flex h-14 max-w-6xl items-center justify-between px-5 sm:px-8">
          <Link id="home-brand" href="/" onClick={restart} className="flex min-w-0 items-center gap-2.5" aria-label={copy.brand}>
            <Image id="home-brand-logo" src="/logo.png" alt="" width={26} height={26} className="h-6 w-6 rounded-md object-contain" priority />
            <span id="home-brand-name" className="truncate text-[12px] font-bold uppercase tracking-[0.14em]">{copy.brand}</span>
          </Link>
          <nav id="home-nav" className="flex items-center gap-1.5">
            <div
              id="home-locale-toggle"
              role="group"
              aria-label={copy.languageLabel}
              className="flex h-8 items-center rounded-full border border-[var(--border-hairline)] bg-[var(--surface-raised)]/60 p-0.5"
            >
              <Languages id="home-locale-icon" className="ml-1.5 hidden h-3.5 w-3.5 text-[var(--text-muted)] sm:block" aria-hidden />
              <LangButton id="home-locale-en" active={locale === "en"} onClick={() => handleLocaleChange("en")} label="EN" />
              <LangButton id="home-locale-zh" active={locale === "zh-TW"} onClick={() => handleLocaleChange("zh-TW")} label="繁中" />
            </div>
            <Link
              id="home-login"
              href="/app"
              className="inline-flex h-8 items-center rounded-full px-3 text-[13px] font-semibold text-[var(--text-muted)] transition hover:text-[var(--text-primary)]"
            >
              {copy.logIn}
            </Link>
          </nav>
        </div>
      </header>

      <main id="home-main" className="relative z-10 flex min-h-[100dvh] flex-col pt-20">
        {/* ─── Hero line + progress rail (middle top) ────────────────────── */}
        <div id="home-hero" className="mx-auto w-full max-w-4xl px-5 pb-6 text-center sm:px-8">
          <ol id="home-progress" className="mb-6 flex items-center justify-center gap-2" aria-label={zh ? "進度" : "Progress"}>
            {PHASE_ORDER.map((p, i) => {
              const currentIdx = PHASE_ORDER.indexOf(phase);
              const state = i < currentIdx ? "done" : i === currentIdx ? "current" : "todo";
              return (
                <li key={p} id={`home-progress-step-${p}`} className="flex items-center gap-2">
                  <button
                    id={`home-progress-btn-${p}`}
                    type="button"
                    onClick={() => goToPhase(p)}
                    disabled={state !== "done"}
                    className={`flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-bold tracking-wide transition-colors duration-300 ${
                      state === "current"
                        ? "bg-[var(--text-primary)] text-[var(--surface-base)]"
                        : state === "done"
                          ? "text-[var(--text-primary)] hover:bg-[var(--surface-raised)]"
                          : "text-[var(--text-faint)]"
                    }`}
                  >
                    <span id={`home-progress-num-${p}`} aria-hidden>{i + 1}</span>
                    {copy.steps[i]}
                  </button>
                  {i < PHASE_ORDER.length - 1 && (
                    <span
                      id={`home-progress-sep-${p}`}
                      aria-hidden
                      className={`h-px w-5 transition-colors duration-300 ${i < currentIdx ? "bg-[var(--text-primary)]" : "bg-[var(--border-strong)]"}`}
                    />
                  )}
                </li>
              );
            })}
          </ol>

          {/* Keyed by the text itself so rotating questions lift out through the
              same baseline mask the next one rises from. */}
          <AnimatePresence mode="wait">
            <HeroTitle key={`${heroTitle}-${locale}`} text={heroTitle} locale={locale} />
          </AnimatePresence>
          {heroSub && (
            <motion.p
              key={`sub-${phase}-${locale}`}
              id="home-hero-sub"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3, duration: 0.4, ease: easeConfirm }}
              className="mt-3 text-[15px] text-[var(--text-muted)]"
            >
              {heroSub}
            </motion.p>
          )}
        </div>

        {/* ─── The stage: one scene at a time ────────────────────────────── */}
        <div id="home-stage" className={`flex-1 ${phase === "globe" || phase === "cities" ? "flex min-h-0 flex-col pb-0" : "pb-10"}`}>
          <AnimatePresence mode="wait">
            {(phase === "globe" || phase === "cities") && (
              <motion.section
                // One key for both phases: AnimatePresence never unmounts the
                // earth between them, so the dive/zoom-out is a single canvas.
                key="scene-earth"
                id="home-scene-earth"
                className="flex min-h-0 flex-1 flex-col"
                initial={{ opacity: 0, scale: 0.96, filter: "blur(8px)" }}
                animate={{ opacity: 1, scale: 1, filter: "blur(0px)", transition: { duration: 0.45, ease: easeConfirm } }}
                // Exit continues the camera plunge EarthScene starts on city
                // click: the whole stage flies past the viewer while the canvas
                // underneath keeps diving toward the picked city.
                exit={{ opacity: 0, scale: 1.14, filter: "blur(10px)", transition: { duration: 0.35, ease: easeConfirm } }}
              >
                <EarthScene
                  locale={locale}
                  country={activeCountry}
                  selectedCity={cityName}
                  onSelectCountry={handleCountrySelect}
                  onSelectCity={handleCitySelect}
                  onBack={restart}
                />
              </motion.section>
            )}

            {phase === "dates" && activeCountry && activeCity && (
              <motion.section
                key="scene-dates"
                id="home-scene-dates"
                initial={{ opacity: 0, scale: 0.97, filter: "blur(8px)" }}
                animate={{ opacity: 1, scale: 1, filter: "blur(0px)", transition: { duration: 0.35, ease: easeConfirm } }}
                exit={{ opacity: 0, scale: 1.04, filter: "blur(8px)", transition: { duration: 0.45, ease: easeConfirm } }}
              >
                <DatesScene
                  key={`${activeCountry.code}-${activeCity.name}-dates`}
                  country={activeCountry}
                  city={activeCity}
                  locale={locale}
                  value={dateRange}
                  onConfirm={handleDatesConfirm}
                  onBack={() => setPhase("cities")}
                />
              </motion.section>
            )}

            {phase === "pois" && activeCountry && activeCity && (
              <motion.section
                key="scene-pois"
                id="home-scene-pois"
                // Arrives out of the dive: slightly small and soft, sharpening
                // quickly — the inner toolbar/filters/cards cascade carries the
                // rest of the entrance.
                initial={{ opacity: 0, scale: 0.97, filter: "blur(8px)" }}
                animate={{ opacity: 1, scale: 1, filter: "blur(0px)", transition: { duration: 0.35, ease: easeConfirm } }}
                exit={{ opacity: 0, scale: 1.04, filter: "blur(8px)", transition: { duration: 0.45, ease: easeConfirm } }}
              >
                <PoiScene
                  key={`${activeCountry.code}-${activeCity.name}`}
                  country={activeCountry}
                  city={activeCity}
                  locale={locale}
                  selectedIds={selectedPoiIds}
                  trendingPois={trendingPois}
                  onToggle={togglePoi}
                  onSubmit={() => setPhase("reasoning")}
                  onBack={() => setPhase("cities")}
                />
              </motion.section>
            )}

            {phase === "reasoning" && activeCountry && (
              <motion.section
                key="scene-reasoning"
                id="home-scene-reasoning"
                initial={{ opacity: 0, scale: 0.97, filter: "blur(8px)" }}
                animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
                exit={{ opacity: 0, scale: 1.04, filter: "blur(8px)" }}
                transition={{ duration: 0.45, ease: easeConfirm }}
              >
                <ReasoningScene
                  country={activeCountry}
                  locale={locale}
                  poiIds={[...selectedPoiIds]}
                  startDate={dateRange?.start}
                  tripDays={dateRange ? isoDiffDays(dateRange.start, dateRange.end) + 1 : undefined}
                  onComplete={(result) => {
                    setItinerary(result);
                    setPhase("itinerary");
                  }}
                  onBack={() => setPhase("pois")}
                />
              </motion.section>
            )}

            {phase === "itinerary" && activeCountry && itinerary && (
              <motion.section
                key="scene-itinerary"
                id="home-scene-itinerary"
                initial={{ opacity: 0, scale: 0.97, filter: "blur(8px)" }}
                animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
                exit={{ opacity: 0, scale: 1.04, filter: "blur(8px)" }}
                transition={{ duration: 0.45, ease: easeConfirm }}
              >
                <ItineraryScene itinerary={itinerary} country={activeCountry} locale={locale} onRestart={restart} />
              </motion.section>
            )}
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}

// ─── Pieces ──────────────────────────────────────────────────────────────────

interface HeroUnit {
  text: string;
  /** Rendered flush against the previous unit (trailing punctuation). */
  glue: boolean;
}

/** Splits the headline into animated units — words for EN, characters for
 *  zh — splitting any trailing punctuation into its own flush unit. */
function buildHeroUnits(text: string, zh: boolean): HeroUnit[] {
  const raw = zh ? Array.from(text) : text.split(" ").filter(Boolean);
  const units: HeroUnit[] = [];
  raw.forEach((u) => {
    if (!zh) {
      const tail = u.match(/[?？!！.。…，,、]+$/);
      if (tail && tail.index && tail.index > 0) {
        units.push({ text: u.slice(0, tail.index), glue: false });
        units.push({ text: u.slice(tail.index), glue: true });
        return;
      }
    }
    units.push({ text: u, glue: false });
  });
  return units;
}

/** Masked rise-and-settle headline: each word (character for zh) climbs out of
 *  an invisible baseline slot with a slight straightening tilt, overshoots a
 *  touch and settles. On re-type (rotating globe questions, phase changes) the
 *  old line lifts back out through the same mask before the next rises in. */
function HeroTitle({ text, locale }: { text: string; locale: Locale }) {
  const zh = locale === "zh-TW";
  const units = buildHeroUnits(text, zh);
  const stagger = zh ? 0.05 : 0.07;
  return (
    <h1
      id="home-hero-title"
      className="text-display text-[clamp(1.9rem,5.2vw,3.4rem)]"
      aria-label={text}
    >
      {units.map((unit, i) => (
        <span
          key={`${i}-${unit.text}`}
          id={`home-hero-unit-${i}`}
          // The mask: clips the unit while it travels, with a little padding
          // headroom (negated by margins) so overshoot and descenders survive.
          className={`inline-block overflow-hidden py-[0.14em] -my-[0.14em] align-baseline ${
            !zh && i < units.length - 1 && !units[i + 1].glue ? "mr-[0.28em]" : ""
          }`}
          aria-hidden
        >
          <motion.span
            initial={{ y: "120%", rotate: 6 }}
            animate={{
              y: "0%",
              rotate: 0,
              transition: { delay: 0.06 + i * stagger, duration: 0.65, ease: [0.33, 1.4, 0.42, 1] },
            }}
            exit={{
              y: "-120%",
              rotate: -4,
              transition: { delay: i * 0.025, duration: 0.28, ease: [0.55, 0, 0.8, 0.4] },
            }}
            className="inline-block origin-bottom-left will-change-transform"
          >
            {unit.text}
          </motion.span>
        </span>
      ))}
    </h1>
  );
}

function LangButton({ id, active, onClick, label }: { id: string; active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      id={id}
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`h-7 rounded-full px-2.5 text-[12px] font-bold transition ${
        active
          ? "bg-[var(--text-primary)] text-[var(--surface-base)]"
          : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
      }`}
    >
      {label}
    </button>
  );
}

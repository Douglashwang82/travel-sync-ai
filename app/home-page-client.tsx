'use client'

// ─────────────────────────────────────────────────────────────────────────────
// Index page — a single interactive survey pipeline, nothing else.
//
//   globe      → spinning dotted earth; pick a country marker
//   cities     → zoomed earth; pick an available city marker
//   pois       → that city's POIs take the stage as a media wall
//   reasoning  → the AI agent visibly plans (SSE from /api/home/itinerary)
//   itinerary  → animated map + dated, timed, costed plan
//
// Scene hand-offs are choreographed with AnimatePresence (scale + blur
// cross-morphs, plus a camera "dive" into the globe on country select). The
// hero line at the top-middle re-types itself per phase. Bilingual (EN /
// zh-TW) with the locale persisted under the same key the old page used.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { Languages } from "lucide-react";
import CityScene from "@/components/home/city-scene";
import GlobeScene from "@/components/home/globe-scene";
import PoiScene from "@/components/home/poi-scene";
import ReasoningScene from "@/components/home/reasoning-scene";
import ItineraryScene from "@/components/home/itinerary-scene";
import { easeConfirm } from "@/components/motion/variants";
import { getHomeCity, getHomeCountry, type HomeCity, type HomeCountryCode, type HomeItinerary } from "@/lib/home-survey";

type Locale = "en" | "zh-TW";
type Phase = "globe" | "cities" | "pois" | "reasoning" | "itinerary";

const LANGUAGE_STORAGE_KEY = "travelsync-home-locale";
const PHASE_ORDER: Phase[] = ["globe", "cities", "pois", "reasoning", "itinerary"];
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
    steps: ["Destination", "City", "Spots", "AI plan", "Itinerary"],
    globeTitle: "Where do you want to go?",
    globeSub: "Spin the globe — tap a marker to begin.",
    citiesTitle: "Which city should we zoom into?",
    citiesSub: (name: string) => `Available cities in ${name}.`,
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
    steps: ["目的地", "城市", "景點", "AI 規劃", "行程"],
    globeTitle: "你想去哪裡？",
    globeSub: "轉動地球，點選圖釘開始。",
    citiesTitle: "想先放大哪座城市？",
    citiesSub: (name: string) => `${name}目前可選的城市。`,
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
  const [diving, setDiving] = useState(false);
  const [selectedPoiIds, setSelectedPoiIds] = useState<ReadonlySet<string>>(new Set());
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

  const handleLocaleChange = useCallback((nextLocale: Locale) => {
    setLocale(nextLocale);
    setGlobeQuestionIndex(0);
  }, []);

  const handleCountrySelect = useCallback((code: HomeCountryCode) => {
    setCountry(code);
    setCityName(null);
    setSelectedPoiIds(new Set());
    setDiving(true);
    // Let the globe's full dive-zoom play out before handing off to CityScene
    // (which mounts already at focus). Matches ZOOM_MS in globe-scene.
    window.setTimeout(() => {
      setDiving(false);
      setPhase("cities");
    }, 1000);
  }, []);

  const handleCitySelect = useCallback((city: HomeCity) => {
    setCityName(city.name);
    setSelectedPoiIds(new Set());
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
      } else if (target === "pois" && country && cityName) {
        setItinerary(null);
        setPhase("pois");
      }
    },
    [phase, country, cityName, restart],
  );

  const heroTitle =
    phase === "globe"
      ? (GLOBE_ROTATING_QUESTIONS[locale][globeQuestionIndex] ?? copy.globeTitle)
      : phase === "cities"
        ? copy.citiesTitle
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
                        ? "bg-[var(--accent-line)] text-white shadow-[var(--accent-line-glow)]"
                        : state === "done"
                          ? "text-[var(--accent-line)] hover:bg-[var(--accent-line-soft)]"
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
                      className={`h-px w-5 transition-colors duration-300 ${i < currentIdx ? "bg-[var(--accent-line)]" : "bg-[var(--border-strong)]"}`}
                    />
                  )}
                </li>
              );
            })}
          </ol>

          <HeroTitle key={`${phase}-${locale}`} text={heroTitle} locale={locale} />
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
            {phase === "globe" && (
              <motion.section
                key="scene-globe"
                id="home-scene-globe"
                className="flex min-h-0 flex-1 flex-col"
                initial={{ opacity: 0, scale: 0.96, filter: "blur(8px)" }}
                animate={
                  // The dive happens entirely on the canvas (the earth scales
                  // toward the country). Keep the section fully visible the whole
                  // time so there is no fade — CityScene then continues the zoom.
                  diving
                    ? { opacity: 1, scale: 1, filter: "blur(0px)", transition: { duration: 0 } }
                    : { opacity: 1, scale: 1, filter: "blur(0px)", transition: { duration: 0.45, ease: easeConfirm } }
                }
                // Instant unmount — CityScene mounts on the identical frame.
                exit={{ opacity: 1, transition: { duration: 0 } }}
              >
                <GlobeScene locale={locale} selected={country} onSelect={handleCountrySelect} />
              </motion.section>
            )}

            {phase === "cities" && activeCountry && (
              <motion.section
                key="scene-cities"
                id="home-scene-cities"
                className="flex min-h-0 flex-1 flex-col"
                // Mounts on the identical frame the globe left off — no fade in,
                // the remaining zoom into focus is driven inside CityScene.
                initial={{ opacity: 1 }}
                animate={{ opacity: 1, transition: { duration: 0 } }}
                exit={{ opacity: 0, scale: 1.06, filter: "blur(8px)", transition: { duration: 0.4, ease: easeConfirm } }}
              >
                <CityScene
                  country={activeCountry}
                  locale={locale}
                  selected={cityName}
                  onSelect={handleCitySelect}
                  onBack={restart}
                />
              </motion.section>
            )}

            {phase === "pois" && activeCountry && activeCity && (
              <motion.section
                key="scene-pois"
                id="home-scene-pois"
                initial={{ opacity: 0, scale: 0.97, filter: "blur(8px)" }}
                animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
                exit={{ opacity: 0, scale: 1.04, filter: "blur(8px)" }}
                transition={{ duration: 0.45, ease: easeConfirm }}
              >
                <PoiScene
                  key={`${activeCountry.code}-${activeCity.name}`}
                  country={activeCountry}
                  city={activeCity}
                  locale={locale}
                  selectedIds={selectedPoiIds}
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

/** Word-staggered (character-staggered for zh) hero headline. */
function HeroTitle({ text, locale }: { text: string; locale: Locale }) {
  const units = locale === "zh-TW" ? Array.from(text) : text.split(" ");
  return (
    <h1
      id="home-hero-title"
      className="text-display text-[clamp(1.9rem,5.2vw,3.4rem)]"
      aria-label={text}
    >
      {units.map((unit, i) => (
        <motion.span
          key={`${i}-${unit}`}
          initial={{ opacity: 0, y: "0.4em", filter: "blur(6px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={{ delay: 0.05 + i * 0.07, duration: 0.5, ease: easeConfirm }}
          className={`inline-block ${i === units.length - 1 ? "text-gradient-aurora" : ""} ${
            locale === "en" && i < units.length - 1 ? "mr-[0.28em]" : ""
          }`}
          aria-hidden
        >
          {unit}
        </motion.span>
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

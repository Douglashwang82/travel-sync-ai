'use client'

// ─────────────────────────────────────────────────────────────────────────────
// PoiScene — phase 2 of the index-page survey pipeline, as a travel magazine
// you scroll through.
//
// Every POI is a full editorial spread — typographic left page (ghost folio
// number, kicker rule, oversized headline, standfirst, mono fact box, a
// passport-stamp "in the trip" pick state) facing a full-bleed photo page —
// stacked vertically in a scroll-snap reader: each scroll gesture lands on
// the next spread, one POI at a time. Live trending cards (from
// /api/home/trending-pois) open the issue with a "hot right now" ribbon.
//
// The folio counter, progress rule and the contents film-strip all track the
// spread currently in view (IntersectionObserver). ↑/↓ (or ←/→) also page;
// Enter/Space stamps the current spread into the trip. Photos stream from
// /api/home/poi-photo with the same gradient + emoji fallback as before.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronLeft,
  Clock,
  Flame,
  Heart,
  Plus,
} from "lucide-react";
import {
  getHomeCategoryMeta,
  getHomePois,
  type HomeCity,
  type HomeCountry,
  type HomePoi,
} from "@/lib/home-survey";
import { easeConfirm, springSnappy } from "@/components/motion/variants";

export const MIN_POI_PICKS = 3;

interface PoiSceneProps {
  country: HomeCountry;
  city?: HomeCity;
  locale: "en" | "zh-TW";
  selectedIds: ReadonlySet<string>;
  /** Live trending cards from /api/home/trending-pois, opening the issue. */
  trendingPois?: HomePoi[];
  onToggle: (id: string) => void;
  onSubmit: () => void;
  onBack: () => void;
}

export default function PoiScene({ country, city, locale, selectedIds, trendingPois, onToggle, onSubmit, onBack }: PoiSceneProps) {
  const zh = locale === "zh-TW";

  const pois = useMemo(() => {
    const catalog = getHomePois(country.code, city?.name);
    // Live trending spreads open the issue; a catalog spot that is also
    // trending keeps its curated spread (dedupe by name) so ids stay stable.
    const catalogNames = new Set(catalog.map((p) => p.name.toLowerCase()));
    const live = (trendingPois ?? []).filter((p) => !catalogNames.has(p.name.toLowerCase()));
    return [...live, ...catalog];
  }, [country.code, city?.name, trendingPois]);

  const total = pois.length;
  const readerRef = useRef<HTMLDivElement | null>(null);
  // Index of the spread currently occupying the reader, kept by the observer.
  const [current, setCurrent] = useState(0);

  const pickOrder = useMemo(() => new Map([...selectedIds].map((id, i) => [id, i + 1])), [selectedIds]);
  const count = selectedIds.size;
  const minPicks = Math.min(MIN_POI_PICKS, Math.max(1, total));
  const ready = count >= minPicks;

  const scrollToSpread = (index: number) => {
    const target = pois[index];
    if (!target) return;
    document
      .getElementById(`home-poi-spread-${target.id}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // Track which spread owns the viewport so the folio, progress rule and
  // film-strip follow the reader's scroll position.
  useEffect(() => {
    const root = readerRef.current;
    if (!root || total === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const idx = Number((entry.target as HTMLElement).dataset.spreadIndex);
          if (Number.isFinite(idx)) setCurrent(idx);
        }
      },
      { root, threshold: 0.55 }
    );
    for (const el of root.querySelectorAll("[data-spread-index]")) observer.observe(el);
    return () => observer.disconnect();
  }, [pois, total]);

  // ↑/↓ (and ←/→) page between spreads; Enter or Space stamps the current one.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
      if (e.key === "ArrowDown" || e.key === "ArrowRight") {
        e.preventDefault();
        scrollToSpread(Math.min(current + 1, total - 1));
      } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
        e.preventDefault();
        scrollToSpread(Math.max(current - 1, 0));
      } else if ((e.key === "Enter" || e.key === " ") && target.tagName !== "BUTTON" && pois[current]) {
        e.preventDefault();
        onToggle(pois[current].id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, total, pois, onToggle]);

  if (total === 0) {
    return (
      <div id="home-poi-scene" className="mx-auto w-full max-w-5xl px-5 py-20 text-center sm:px-8">
        <p id="home-poi-empty-text" className="text-[15px] font-semibold text-[var(--text-muted)]">
          {zh ? "這個城市還沒有景點。" : "No spots for this city yet."}
        </p>
      </div>
    );
  }

  const issueName = (city?.name ?? country.name).toUpperCase();

  return (
    <div id="home-poi-scene" className="mx-auto flex w-full max-w-6xl flex-col px-5 sm:px-8">
      {/* ─── Masthead: back · issue line · picks ─────────────────────────── */}
      <motion.div
        id="home-poi-masthead"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: easeConfirm }}
        className="mb-3 flex items-center justify-between gap-3"
      >
        <button
          id="home-poi-back"
          type="button"
          onClick={onBack}
          className="inline-flex h-9 items-center gap-1 rounded-full border border-[var(--border-hairline)] bg-[var(--surface-raised)] px-3.5 text-[13px] font-semibold text-[var(--text-muted)] transition hover:text-[var(--text-primary)]"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
          {city ? (zh ? "重選城市" : "Change city") : zh ? "重選國家" : "Change country"}
        </button>
        <p id="home-poi-issue-line" className="text-mono hidden text-[11px] font-semibold uppercase tracking-[0.28em] text-[var(--text-faint)] sm:block">
          {country.flag} {issueName} {zh ? "特輯" : "ISSUE"} — {zh ? "往下捲動閱讀" : "SCROLL TO READ"}
        </p>
        <p id="home-poi-pick-counter" className="text-mono text-[13px] font-semibold text-[var(--text-muted)]">
          <span id="home-poi-pick-count" className={count > 0 ? "text-[var(--accent-line)]" : ""}>{count}</span>
          {zh ? ` 個已選 · 至少 ${minPicks}` : ` picked · min ${minPicks}`}
        </p>
      </motion.div>

      {/* ─── Folio progress rule ─────────────────────────────────────────── */}
      <motion.div
        id="home-poi-progress"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.35, ease: easeConfirm, delay: 0.05 }}
        className="mb-4 flex items-center gap-3"
      >
        <span id="home-poi-folio" className="text-mono shrink-0 text-[12px] font-bold tabular-nums text-[var(--text-primary)]">
          {String(current + 1).padStart(2, "0")}
          <span className="text-[var(--text-faint)]"> / {String(total).padStart(2, "0")}</span>
        </span>
        <span id="home-poi-progress-rail" aria-hidden className="relative h-px flex-1 bg-[var(--border-hairline)]">
          <motion.span
            id="home-poi-progress-ink"
            className="absolute inset-y-0 left-0 -my-px h-[3px] rounded-full bg-[var(--accent-line)]"
            animate={{ width: `${((current + 1) / total) * 100}%` }}
            transition={{ duration: 0.4, ease: easeConfirm }}
          />
        </span>
        <span id="home-poi-progress-hint" className="text-mono hidden shrink-0 text-[11px] text-[var(--text-faint)] sm:block">
          ↓ {zh ? "捲動翻頁" : "scroll to read"} · ↵ {zh ? "選入" : "to pick"}
        </span>
      </motion.div>

      {/* ─── The reader: snap-scrolled stack of spreads ──────────────────── */}
      <div
        id="home-poi-reader"
        ref={readerRef}
        className="h-[calc(100dvh-330px)] min-h-[480px] snap-y snap-mandatory overflow-y-auto overscroll-contain rounded-[1.6rem] border border-[var(--border-hairline)] shadow-[var(--shadow-deep)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {pois.map((poi, i) => {
          const picked = selectedIds.has(poi.id);
          const pickIndex = pickOrder.get(poi.id);
          return (
            <section
              key={poi.id}
              id={`home-poi-spread-${poi.id}`}
              data-spread-index={i}
              aria-label={zh ? poi.nameZh : poi.name}
              className="relative h-full w-full snap-start overflow-hidden border-b border-[var(--border-hairline)] bg-[var(--surface-raised)] last:border-b-0"
            >
              <div id={`home-poi-spread-grid-${poi.id}`} className="grid h-full lg:grid-cols-[1.05fr_1fr]">
                {/* ── Photo page (top on mobile, right on desktop) ─────── */}
                <div id={`home-poi-photo-page-${poi.id}`} className="relative order-1 min-h-[36%] overflow-hidden lg:order-2 lg:min-h-0">
                  <SpreadImage poi={poi} />
                  <span
                    id={`home-poi-photo-scrim-${poi.id}`}
                    aria-hidden
                    className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/70 to-transparent"
                  />
                  {poi.trending && (
                    <span
                      id={`home-poi-trend-ribbon-${poi.id}`}
                      className="absolute left-0 top-5 inline-flex items-center gap-1.5 rounded-r-full bg-gradient-to-r from-orange-500 to-rose-500 py-1.5 pl-3 pr-3.5 text-[11px] font-black uppercase tracking-[0.14em] text-white shadow-lg"
                    >
                      <Flame className="h-3.5 w-3.5" aria-hidden />
                      {zh ? "現正爆紅" : "Hot right now"}
                    </span>
                  )}
                  <span
                    id={`home-poi-photo-credit-${poi.id}`}
                    className="text-mono absolute bottom-3 left-4 right-4 flex items-center justify-between gap-3 text-[10.5px] font-semibold uppercase tracking-[0.2em] text-white/75"
                  >
                    <span id={`home-poi-photo-credit-handle-${poi.id}`} className="truncate">@{poi.handle}</span>
                    <span id={`home-poi-photo-credit-src-${poi.id}`} className="shrink-0">
                      {poi.trending
                        ? (poi.trending.platforms[0] ?? "instagram").toUpperCase()
                        : zh ? "檔案照片" : "ARCHIVE"}
                    </span>
                  </span>
                </div>

                {/* ── Editorial page ───────────────────────────────────── */}
                <motion.div
                  id={`home-poi-editorial-${poi.id}`}
                  initial={{ opacity: 0, y: 28 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ root: readerRef, amount: 0.3 }}
                  transition={{ duration: 0.5, ease: easeConfirm }}
                  className="relative order-2 flex min-h-0 flex-col justify-between gap-5 overflow-hidden p-6 sm:p-9 lg:order-1"
                >
                  {/* Ghost folio number bleeding off the page corner. */}
                  <span
                    id={`home-poi-ghost-folio-${poi.id}`}
                    aria-hidden
                    className="text-display pointer-events-none absolute -right-3 -top-8 select-none text-[9rem] font-black leading-none text-[var(--text-primary)] opacity-[0.05] sm:text-[12rem]"
                  >
                    {String(i + 1).padStart(2, "0")}
                  </span>

                  <div id={`home-poi-editorial-top-${poi.id}`} className="relative">
                    <div id={`home-poi-kicker-${poi.id}`} className="flex items-center gap-3">
                      <span aria-hidden className="h-px w-8 bg-[var(--accent-line)]" />
                      <span className="text-mono text-[11px] font-bold uppercase tracking-[0.28em] text-[var(--text-muted)]">
                        {poi.city} · {getHomeCategoryMeta(poi.category)[zh ? "labelZh" : "label"]}
                      </span>
                    </div>

                    <h2
                      id={`home-poi-headline-${poi.id}`}
                      className="text-display mt-4 text-balance text-[clamp(1.7rem,4vw,3.2rem)] font-black leading-[1.02] tracking-tight text-[var(--text-primary)]"
                    >
                      {zh ? poi.nameZh : poi.name}
                    </h2>

                    <p id={`home-poi-standfirst-${poi.id}`} className="mt-3 line-clamp-4 max-w-[46ch] text-[14.5px] leading-relaxed text-[var(--text-secondary)] sm:mt-4 sm:line-clamp-none sm:text-[15px]">
                      {zh ? poi.blurbZh : poi.blurb}
                    </p>

                    {poi.tags.length > 0 && (
                      <p id={`home-poi-keywords-${poi.id}`} className="text-mono mt-3 truncate text-[11px] uppercase tracking-[0.18em] text-[var(--text-faint)] sm:mt-4">
                        {poi.tags.slice(0, 5).join(" · ")}
                      </p>
                    )}
                  </div>

                  <div id={`home-poi-editorial-bottom-${poi.id}`} className="relative space-y-4 sm:space-y-5">
                    {/* Spec strip — the magazine's fact box. */}
                    <dl id={`home-poi-specs-${poi.id}`} className="flex divide-x divide-[var(--border-hairline)] border-y border-[var(--border-hairline)]">
                      <div id={`home-poi-spec-likes-${poi.id}`} className="flex-1 py-2.5 pr-4 sm:py-3">
                        <dt className="text-mono text-[10px] uppercase tracking-[0.2em] text-[var(--text-faint)]">
                          <Heart className="mr-1 inline h-3 w-3 align-[-1px]" aria-hidden />
                          {zh ? "讚數" : "Likes"}
                        </dt>
                        <dd className="text-mono mt-1 text-[15px] font-bold text-[var(--text-primary)]">{formatCount(poi.likes)}</dd>
                      </div>
                      <div id={`home-poi-spec-stay-${poi.id}`} className="flex-1 px-4 py-2.5 sm:py-3">
                        <dt className="text-mono text-[10px] uppercase tracking-[0.2em] text-[var(--text-faint)]">
                          <Clock className="mr-1 inline h-3 w-3 align-[-1px]" aria-hidden />
                          {zh ? "停留" : "Stay"}
                        </dt>
                        <dd className="text-mono mt-1 text-[15px] font-bold text-[var(--text-primary)]">{formatStay(poi.stayMinutes, zh)}</dd>
                      </div>
                      <div id={`home-poi-spec-cost-${poi.id}`} className="flex-1 py-2.5 pl-4 sm:py-3">
                        <dt className="text-mono text-[10px] uppercase tracking-[0.2em] text-[var(--text-faint)]">{zh ? "花費" : "Cost"}</dt>
                        <dd className="text-mono mt-1 text-[15px] font-bold text-[var(--text-primary)]">{formatCost(poi.costUsd, zh)}</dd>
                      </div>
                    </dl>

                    {/* Pick stamp / CTA. */}
                    <div id={`home-poi-pick-row-${poi.id}`} className="flex flex-wrap items-center gap-3">
                      <button
                        id={`home-poi-pick-${poi.id}`}
                        type="button"
                        onClick={() => onToggle(poi.id)}
                        aria-pressed={picked}
                        className={`inline-flex h-11 items-center gap-2 rounded-full px-6 text-[14px] font-bold transition sm:h-12 sm:text-[14.5px] ${
                          picked
                            ? "border-2 border-[var(--accent-line)] bg-transparent text-[var(--accent-line)]"
                            : "btn-tactile"
                        }`}
                      >
                        {picked ? (
                          <>
                            <Check className="h-4 w-4" strokeWidth={3} aria-hidden />
                            {zh ? "已收入行程" : "In the trip"}
                          </>
                        ) : (
                          <>
                            <Plus className="h-4 w-4" strokeWidth={3} aria-hidden />
                            {zh ? "收入行程" : "Add to trip"}
                          </>
                        )}
                      </button>
                      <AnimatePresence>
                        {picked && pickIndex != null && (
                          <motion.span
                            id={`home-poi-stamp-${poi.id}`}
                            initial={{ opacity: 0, scale: 1.6, rotate: -14 }}
                            animate={{ opacity: 1, scale: 1, rotate: -8 }}
                            exit={{ opacity: 0, scale: 0.6 }}
                            transition={springSnappy}
                            className="text-mono select-none rounded-md border-2 border-[var(--accent-line)] px-2.5 py-1 text-[11px] font-black uppercase tracking-[0.18em] text-[var(--accent-line)]"
                          >
                            {zh ? `第 ${pickIndex} 站` : `Pick Nº ${pickIndex}`}
                          </motion.span>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>
                </motion.div>
              </div>

              {/* Scroll cue — only on the cover spread, fades once you move. */}
              {i === 0 && current === 0 && total > 1 && (
                <motion.button
                  id="home-poi-scroll-cue"
                  type="button"
                  onClick={() => scrollToSpread(1)}
                  aria-label={zh ? "捲動到下一個景點" : "Scroll to the next spot"}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1, y: [0, 6, 0] }}
                  transition={{ opacity: { delay: 0.6 }, y: { repeat: Infinity, duration: 1.6, ease: "easeInOut" } }}
                  className="surface-glass absolute bottom-4 left-1/2 z-10 grid h-10 w-10 -translate-x-1/2 place-items-center rounded-full border border-[var(--border-hairline)] text-[var(--text-primary)] shadow-[var(--shadow-raise)]"
                >
                  <ChevronDown className="h-4 w-4" aria-hidden />
                </motion.button>
              )}
            </section>
          );
        })}
      </div>

      {/* ─── Contents film-strip ─────────────────────────────────────────── */}
      <motion.nav
        id="home-poi-contents"
        aria-label={zh ? "所有景點" : "All spots"}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.38, ease: easeConfirm, delay: 0.12 }}
        className="mt-4 flex gap-2 overflow-x-auto pb-28 pt-1 [scrollbar-width:thin]"
      >
        {pois.map((p, i) => {
          const isCurrent = i === current;
          const order = pickOrder.get(p.id);
          return (
            <button
              key={p.id}
              id={`home-poi-thumb-${p.id}`}
              type="button"
              onClick={() => scrollToSpread(i)}
              aria-label={zh ? p.nameZh : p.name}
              aria-current={isCurrent ? "true" : undefined}
              className={`relative h-14 w-20 shrink-0 overflow-hidden rounded-lg transition-all duration-200 ${
                isCurrent
                  ? "ring-2 ring-[var(--text-primary)] ring-offset-2 ring-offset-[var(--surface-base)]"
                  : order != null
                    ? "ring-2 ring-[var(--accent-line)] ring-offset-1 ring-offset-[var(--surface-base)]"
                    : "opacity-60 ring-1 ring-black/10 hover:opacity-100 dark:ring-white/15"
              }`}
              style={{ background: `linear-gradient(160deg, hsl(${p.hue} 62% 58%), hsl(${(p.hue + 42) % 360} 65% 36%))` }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- proxied thumbnail with designed gradient fallback */}
              <img
                id={`home-poi-thumb-img-${p.id}`}
                src={photoSrc(p.id, 160)}
                alt=""
                loading="lazy"
                className="absolute inset-0 h-full w-full object-cover"
                onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
              />
              {order != null && (
                <span
                  id={`home-poi-thumb-order-${p.id}`}
                  className="absolute right-1 top-1 grid h-5 min-w-5 place-items-center rounded-full bg-[var(--accent-line)] px-1 text-[10px] font-black text-white"
                >
                  {order}
                </span>
              )}
              {p.trending && (
                <Flame
                  id={`home-poi-thumb-flame-${p.id}`}
                  aria-hidden
                  className="absolute bottom-1 left-1 h-3.5 w-3.5 text-orange-400 drop-shadow"
                />
              )}
            </button>
          );
        })}
      </motion.nav>

      {/* ─── Floating submit dock ────────────────────────────────────────── */}
      <div id="home-poi-dock" className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-5">
        <motion.div
          id="home-poi-dock-inner"
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ ...springSnappy, delay: 0.25 }}
          className="surface-glass pointer-events-auto flex items-center gap-4 rounded-full border border-[var(--border-hairline)] py-2 pl-5 pr-2 shadow-[var(--shadow-deep)]"
        >
          <p id="home-poi-dock-hint" className="text-[13px] font-medium text-[var(--text-muted)]">
            {ready
              ? zh ? "選好了就出發！" : "Ready when you are."
              : zh
                ? `再選 ${minPicks - count} 個`
                : `Pick ${minPicks - count} more`}
          </p>
          <button
            id="home-poi-submit"
            type="button"
            disabled={!ready}
            onClick={onSubmit}
            className="btn-tactile h-11 rounded-full px-5 text-[14px] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
          >
            {zh ? "生成我的行程" : "Build my itinerary"}
            <ArrowRight className="h-4 w-4" aria-hidden />
          </button>
        </motion.div>
      </div>
    </div>
  );
}

// ─── Photo page ───────────────────────────────────────────────────────────────

function photoSrc(id: string, w: number): string {
  return `/api/home/poi-photo?id=${encodeURIComponent(id)}&w=${w}`;
}

function SpreadImage({ poi }: { poi: HomePoi }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <span
      id={`home-poi-media-${poi.id}`}
      className="absolute inset-0 block overflow-hidden"
      style={{
        background: `linear-gradient(160deg, hsl(${poi.hue} 62% 58%), hsl(${(poi.hue + 42) % 360} 65% 36%))`,
      }}
    >
      <span id={`home-poi-media-emoji-${poi.id}`} aria-hidden className="absolute inset-0 grid place-items-center text-7xl opacity-80">
        {poi.emoji}
      </span>
      {!failed && (
        // eslint-disable-next-line @next/next/no-img-element -- proxied hero photo with a designed fallback underneath
        <img
          id={`home-poi-media-img-${poi.id}`}
          src={photoSrc(poi.id, 1200)}
          alt={poi.name}
          loading="lazy"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-700 ${
            loaded ? "home-kenburns opacity-100" : "opacity-0"
          }`}
        />
      )}
    </span>
  );
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

/** 48213 → "48.2k", 118530 → "119k", 850 → "850". */
function formatCount(n: number): string {
  if (n < 1000) return String(n);
  const k = n / 1000;
  return `${k >= 100 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, "")}k`;
}

function formatStay(minutes: number, zh: boolean): string {
  if (minutes < 60) return zh ? `${minutes} 分` : `${minutes} min`;
  const hours = (minutes / 60).toFixed(1).replace(/\.0$/, "");
  return zh ? `${hours} 小時` : `${hours} h`;
}

function formatCost(costUsd: number, zh: boolean): string {
  return costUsd <= 0 ? (zh ? "免費" : "Free") : `~$${costUsd}`;
}

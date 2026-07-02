'use client'

// ─────────────────────────────────────────────────────────────────────────────
// PoiScene — phase 2 of the index-page survey pipeline.
//
// The selected country's POIs take over the stage as a media wall: photo
// cards, faux-video tiles (Ken Burns + runtime chrome) and Instagram-styled
// posts. Real photos stream in from /api/home/poi-photo (Google Places via a
// keyless proxy); every card is born with a deterministic gradient + emoji
// placeholder so the wall looks designed even with zero connectivity.
//
// Before picking, visitors can narrow the wall: a keyword search box matches
// names, blurbs and tags, and category chips (Landmarks, Food, Nature, …)
// filter by bucket. Selection persists across filters — hidden picks still
// count toward the minimum. Visitors multi-select cards, then submit to wake
// the AI planner.
// ─────────────────────────────────────────────────────────────────────────────

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, Bookmark, Check, ChevronLeft, Heart, MessageCircle, Play, Search, Send, X } from "lucide-react";
import {
  getHomeCategoryMeta,
  getHomePoiCategories,
  getHomePois,
  matchesHomePoiQuery,
  type HomeCategoryMeta,
  type HomeCity,
  type HomeCountry,
  type HomePoi,
  type HomePoiCategory,
} from "@/lib/home-survey";
import { fadeUp, springSnappy, staggerContainer } from "@/components/motion/variants";

export const MIN_POI_PICKS = 3;

interface PoiSceneProps {
  country: HomeCountry;
  city?: HomeCity;
  locale: "en" | "zh-TW";
  selectedIds: ReadonlySet<string>;
  onToggle: (id: string) => void;
  onSubmit: () => void;
  onBack: () => void;
}

export default function PoiScene({ country, city, locale, selectedIds, onToggle, onSubmit, onBack }: PoiSceneProps) {
  const zh = locale === "zh-TW";
  const pois = useMemo(() => getHomePois(country.code, city?.name), [country.code, city?.name]);
  const categories = useMemo(() => getHomePoiCategories(pois), [pois]);

  // Filter state is reset on a new POI set by remounting via `key` from the parent.
  const [query, setQuery] = useState("");
  const [activeCats, setActiveCats] = useState<ReadonlySet<HomePoiCategory>>(new Set());

  const visiblePois = useMemo(
    () =>
      pois.filter(
        (poi) => (activeCats.size === 0 || activeCats.has(poi.category)) && matchesHomePoiQuery(poi, query),
      ),
    [pois, activeCats, query],
  );

  const count = selectedIds.size;
  const minPicks = Math.min(MIN_POI_PICKS, pois.length);
  const ready = count >= minPicks;

  const toggleCat = (id: HomePoiCategory) => {
    setActiveCats((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const clearFilters = () => {
    setQuery("");
    setActiveCats(new Set());
  };

  return (
    <div id="home-poi-scene" className="mx-auto w-full max-w-6xl px-5 sm:px-8">
      <div id="home-poi-toolbar" className="mb-4 flex items-center justify-between gap-3">
        <button
          id="home-poi-back"
          type="button"
          onClick={onBack}
          className="inline-flex h-9 items-center gap-1 rounded-full border border-[var(--border-hairline)] bg-[var(--surface-raised)] px-3.5 text-[13px] font-semibold text-[var(--text-muted)] transition hover:text-[var(--text-primary)]"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
          {city ? (zh ? "重選城市" : "Change city") : zh ? "重選國家" : "Change country"}
        </button>
        <p id="home-poi-counter" className="text-mono text-[13px] font-semibold text-[var(--text-muted)]">
          <span id="home-poi-counter-count" className={count > 0 ? "text-[var(--accent-line)]" : ""}>{count}</span>
          {zh ? ` 個已選 · 至少 ${minPicks} 個` : ` picked · at least ${minPicks}`}
        </p>
      </div>

      {/* ─── Filter bar: keyword search + category chips ───────────────────── */}
      <div id="home-poi-filters" className="mb-5 space-y-3">
        <div id="home-poi-search" className="relative">
          <Search
            id="home-poi-search-icon"
            aria-hidden
            className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]"
          />
          <input
            id="home-poi-search-input"
            type="search"
            inputMode="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={zh ? "搜尋關鍵字：寺廟、夜市、免費、看夕陽…" : "Search keywords — temple, market, free, sunset…"}
            aria-label={zh ? "以關鍵字搜尋景點" : "Search spots by keyword"}
            className="h-11 w-full rounded-full border border-[var(--border-hairline)] bg-[var(--surface-raised)] pl-10 pr-10 text-[14px] text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-faint)] focus-visible:border-[var(--accent-line)] focus-visible:ring-2 focus-visible:ring-[var(--accent-line-soft)]"
          />
          {query && (
            <button
              id="home-poi-search-clear"
              type="button"
              onClick={() => setQuery("")}
              aria-label={zh ? "清除搜尋" : "Clear search"}
              className="absolute right-3 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-full text-[var(--text-muted)] transition hover:bg-[var(--surface-base)] hover:text-[var(--text-primary)]"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          )}
        </div>

        {categories.length > 1 && (
          <div
            id="home-poi-chips"
            role="group"
            aria-label={zh ? "依類別篩選" : "Filter by category"}
            className="-mx-1 flex flex-nowrap gap-2 overflow-x-auto px-1 pb-1 sm:flex-wrap sm:overflow-visible"
          >
            <FilterChip
              id="home-poi-chip-all"
              active={activeCats.size === 0}
              onClick={() => setActiveCats(new Set())}
              label={zh ? "全部" : "All"}
              count={pois.length}
            />
            {categories.map((cat) => (
              <FilterChip
                key={cat.id}
                id={`home-poi-chip-${cat.id}`}
                active={activeCats.has(cat.id)}
                onClick={() => toggleCat(cat.id)}
                emoji={cat.emoji}
                label={zh ? cat.labelZh : cat.label}
                count={cat.count}
              />
            ))}
          </div>
        )}
      </div>

      {visiblePois.length > 0 ? (
        <motion.div
          id="home-poi-grid"
          variants={staggerContainer}
          initial="hidden"
          animate="show"
          className="columns-2 gap-3 pb-32 sm:gap-4 md:columns-3 xl:columns-4 [&>*]:mb-3 sm:[&>*]:mb-4"
        >
          <AnimatePresence initial={false}>
            {visiblePois.map((poi) => (
              <motion.div key={poi.id} layout variants={fadeUp} exit={{ opacity: 0, scale: 0.96 }}>
                <PoiCard poi={poi} zh={zh} selected={selectedIds.has(poi.id)} onToggle={() => onToggle(poi.id)} />
              </motion.div>
            ))}
          </AnimatePresence>
        </motion.div>
      ) : (
        <div id="home-poi-empty" className="flex flex-col items-center gap-3 py-20 text-center">
          <span id="home-poi-empty-emoji" aria-hidden className="text-4xl">🔍</span>
          <p id="home-poi-empty-text" className="text-[15px] font-semibold text-[var(--text-muted)]">
            {zh ? "找不到符合的景點" : "No spots match those filters"}
          </p>
          <button
            id="home-poi-empty-clear"
            type="button"
            onClick={clearFilters}
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[var(--border-hairline)] bg-[var(--surface-raised)] px-4 text-[13px] font-semibold text-[var(--text-primary)] transition hover:border-[var(--accent-line)]"
          >
            {zh ? "清除篩選" : "Clear filters"}
          </button>
        </div>
      )}

      {/* Floating submit dock */}
      <div id="home-poi-dock" className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-5">
        <motion.div
          id="home-poi-dock-inner"
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={springSnappy}
          className="surface-glass pointer-events-auto flex items-center gap-4 rounded-full border border-[var(--border-hairline)] py-2 pl-5 pr-2 shadow-[var(--shadow-deep)]"
        >
          <p id="home-poi-dock-hint" className="text-[13px] font-medium text-[var(--text-muted)]">
            {ready
              ? zh ? "準備好了！" : "Ready when you are."
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

// ─── Filter chip ───────────────────────────────────────────────────────────────

function FilterChip({
  id,
  active,
  onClick,
  label,
  count,
  emoji,
}: {
  id: string;
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  emoji?: string;
}) {
  return (
    <button
      id={id}
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-[13px] font-semibold transition ${
        active
          ? "border-[var(--accent-line)] bg-[var(--accent-line)] text-white shadow-[var(--accent-line-glow)]"
          : "border-[var(--border-hairline)] bg-[var(--surface-raised)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
      }`}
    >
      {emoji && <span aria-hidden>{emoji}</span>}
      {label}
      <span className={`text-[11px] font-bold ${active ? "text-white/80" : "text-[var(--text-faint)]"}`}>{count}</span>
    </button>
  );
}

// ─── Cards ───────────────────────────────────────────────────────────────────

function PoiCard({ poi, zh, selected, onToggle }: { poi: HomePoi; zh: boolean; selected: boolean; onToggle: () => void }) {
  const name = zh ? poi.nameZh : poi.name;
  const categoryMeta = getHomeCategoryMeta(poi.category);
  return (
    <button
      id={`home-poi-card-${poi.id}`}
      type="button"
      onClick={onToggle}
      aria-pressed={selected}
      className={`group relative block w-full overflow-hidden text-left transition-transform duration-200 [break-inside:avoid] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-line)] ${
        selected ? "scale-[0.985]" : "hover:-translate-y-0.5"
      } ${poi.media === "insta" ? "rounded-2xl" : "rounded-2xl"}`}
    >
      <span
        id={`home-poi-card-ring-${poi.id}`}
        aria-hidden
        className={`pointer-events-none absolute inset-0 z-20 rounded-2xl transition-all duration-200 ${
          selected
            ? "ring-[3px] ring-[var(--accent-line)] ring-offset-2 ring-offset-[var(--surface-base)]"
            : "ring-1 ring-black/5 dark:ring-white/10"
        }`}
      />
      <motion.span
        id={`home-poi-card-check-${poi.id}`}
        aria-hidden
        initial={false}
        animate={selected ? { scale: 1, opacity: 1 } : { scale: 0.5, opacity: 0 }}
        transition={springSnappy}
        className="absolute right-2.5 top-2.5 z-20 grid h-7 w-7 place-items-center rounded-full bg-[var(--accent-line)] text-white shadow-[var(--accent-line-glow)]"
      >
        <Check className="h-4 w-4" strokeWidth={3} />
      </motion.span>

      {poi.media === "insta" ? (
        <InstaCard poi={poi} name={name} zh={zh} categoryMeta={categoryMeta} />
      ) : poi.media === "video" ? (
        <VideoCard poi={poi} name={name} zh={zh} categoryMeta={categoryMeta} />
      ) : (
        <PhotoCard poi={poi} name={name} zh={zh} categoryMeta={categoryMeta} />
      )}
    </button>
  );
}

function CategoryTag({ meta, zh, id }: { meta: HomeCategoryMeta; zh: boolean; id: string }) {
  return (
    <span
      id={id}
      className="inline-flex items-center gap-1 rounded-full bg-white/15 px-1.5 py-0.5 text-[10px] font-semibold text-white backdrop-blur-sm"
    >
      <span aria-hidden>{meta.emoji}</span>
      {zh ? meta.labelZh : meta.label}
    </span>
  );
}

function MediaImage({ poi, className, kenburns = false }: { poi: HomePoi; className?: string; kenburns?: boolean }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <span
      id={`home-poi-media-${poi.id}`}
      className={`relative block overflow-hidden ${className ?? ""}`}
      style={{
        background: `linear-gradient(160deg, hsl(${poi.hue} 62% 58%), hsl(${(poi.hue + 42) % 360} 65% 36%))`,
      }}
    >
      <span id={`home-poi-media-emoji-${poi.id}`} aria-hidden className="absolute inset-0 grid place-items-center text-5xl opacity-80">
        {poi.emoji}
      </span>
      {!failed && (
        // eslint-disable-next-line @next/next/no-img-element -- proxied, lazily streamed photo with a designed fallback underneath
        <img
          id={`home-poi-media-img-${poi.id}`}
          src={`/api/home/poi-photo?id=${encodeURIComponent(poi.id)}&w=640`}
          alt={poi.name}
          loading="lazy"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-700 ${loaded ? "opacity-100" : "opacity-0"} ${
            kenburns && loaded ? "home-kenburns" : ""
          }`}
        />
      )}
    </span>
  );
}

function PhotoCard({ poi, name, zh, categoryMeta }: { poi: HomePoi; name: string; zh: boolean; categoryMeta: HomeCategoryMeta }) {
  return (
    <span id={`home-poi-photo-${poi.id}`} className="relative block">
      <MediaImage poi={poi} className="aspect-[4/5] w-full" />
      <span id={`home-poi-photo-scrim-${poi.id}`} aria-hidden className="absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-black/70 to-transparent" />
      <span id={`home-poi-photo-caption-${poi.id}`} className="absolute inset-x-0 bottom-0 p-3">
        <span id={`home-poi-photo-name-${poi.id}`} className="block text-[14px] font-bold leading-tight text-white">{name}</span>
        <span id={`home-poi-photo-meta-${poi.id}`} className="mt-1 flex flex-wrap items-center gap-1.5">
          <span id={`home-poi-photo-city-${poi.id}`} className="text-[11px] font-medium text-white/75">📍 {poi.city}</span>
          <CategoryTag id={`home-poi-photo-cat-${poi.id}`} meta={categoryMeta} zh={zh} />
        </span>
      </span>
    </span>
  );
}

function VideoCard({ poi, name, zh, categoryMeta }: { poi: HomePoi; name: string; zh: boolean; categoryMeta: HomeCategoryMeta }) {
  const secs = poi.videoSeconds ?? 30;
  return (
    <span id={`home-poi-video-${poi.id}`} className="relative block">
      <MediaImage poi={poi} className="aspect-[3/4] w-full" kenburns />
      <span id={`home-poi-video-scrim-${poi.id}`} aria-hidden className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/25" />
      <span id={`home-poi-video-live-${poi.id}`} className="absolute left-2.5 top-2.5 flex items-center gap-1.5 rounded-full bg-black/45 px-2 py-1 text-[10px] font-bold tracking-wide text-white backdrop-blur-sm">
        <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
        0:{String(secs).padStart(2, "0")}
      </span>
      <span
        id={`home-poi-video-play-${poi.id}`}
        aria-hidden
        className="absolute left-1/2 top-1/2 grid h-12 w-12 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white/20 backdrop-blur-md transition-transform duration-200 group-hover:scale-110"
      >
        <Play className="h-5 w-5 fill-white text-white" />
      </span>
      <span id={`home-poi-video-caption-${poi.id}`} className="absolute inset-x-0 bottom-0 p-3">
        <span id={`home-poi-video-name-${poi.id}`} className="block text-[14px] font-bold leading-tight text-white">{name}</span>
        <span id={`home-poi-video-meta-${poi.id}`} className="mt-1 flex flex-wrap items-center gap-1.5">
          <span id={`home-poi-video-city-${poi.id}`} className="text-[11px] font-medium text-white/75">🎬 {poi.city}</span>
          <CategoryTag id={`home-poi-video-cat-${poi.id}`} meta={categoryMeta} zh={zh} />
        </span>
      </span>
    </span>
  );
}

function InstaCard({ poi, name, zh, categoryMeta }: { poi: HomePoi; name: string; zh: boolean; categoryMeta: HomeCategoryMeta }) {
  return (
    <span id={`home-poi-insta-${poi.id}`} className="block bg-[var(--surface-raised)]">
      <span id={`home-poi-insta-head-${poi.id}`} className="flex items-center gap-2 px-2.5 py-2">
        <span
          id={`home-poi-insta-avatar-${poi.id}`}
          aria-hidden
          className="grid h-7 w-7 place-items-center rounded-full bg-[conic-gradient(from_210deg,#feda75,#fa7e1e,#d62976,#962fbf,#4f5bd5,#feda75)] p-[2px]"
        >
          <span className="grid h-full w-full place-items-center rounded-full bg-[var(--surface-raised)] text-[11px]">{poi.emoji}</span>
        </span>
        <span id={`home-poi-insta-handle-${poi.id}`} className="min-w-0 flex-1 truncate text-[12px] font-bold">@{poi.handle}</span>
        <span id={`home-poi-insta-more-${poi.id}`} aria-hidden className="text-[var(--text-muted)]">···</span>
      </span>
      <span id={`home-poi-insta-media-wrap-${poi.id}`} className="relative block">
        <MediaImage poi={poi} className="aspect-square w-full" />
        <span id={`home-poi-insta-cat-${poi.id}`} className="absolute left-2 top-2">
          <CategoryTag id={`home-poi-insta-cat-tag-${poi.id}`} meta={categoryMeta} zh={zh} />
        </span>
      </span>
      <span id={`home-poi-insta-actions-${poi.id}`} className="flex items-center gap-3 px-2.5 pt-2 text-[var(--text-primary)]">
        <Heart id={`home-poi-insta-like-${poi.id}`} className="h-[18px] w-[18px] fill-[#ff3040] text-[#ff3040]" aria-hidden />
        <MessageCircle className="h-[18px] w-[18px]" aria-hidden />
        <Send className="h-[18px] w-[18px]" aria-hidden />
        <Bookmark className="ml-auto h-[18px] w-[18px]" aria-hidden />
      </span>
      <span id={`home-poi-insta-meta-${poi.id}`} className="block px-2.5 pb-3 pt-1.5">
        <span id={`home-poi-insta-likes-${poi.id}`} className="block text-[12px] font-bold">
          {poi.likes.toLocaleString("en-US")} {zh ? "個讚" : "likes"}
        </span>
        <span id={`home-poi-insta-caption-${poi.id}`} className="mt-0.5 line-clamp-2 block text-[12px] leading-snug text-[var(--text-secondary)]">
          <span className="font-bold">{name}</span> · {zh ? poi.blurbZh : poi.blurb}
        </span>
      </span>
    </span>
  );
}

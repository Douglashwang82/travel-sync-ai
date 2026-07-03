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
// Narrowing happens in a glass command bar: a keyboard-first search field
// ("/" focuses it, Enter commits the query as a removable #token, Backspace
// pops one), tag suggestions, a media-kind segment (photos / clips / posts)
// and a popularity sort — all live-counting the wall below.
// Selection persists across filters — hidden picks still count toward the
// minimum. Visitors multi-select cards (badged with their pick order), then
// submit to wake the AI planner.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowRight,
  AtSign,
  Bookmark,
  Check,
  ChevronLeft,
  Clock,
  Flame,
  Heart,
  Image as ImageIcon,
  MessageCircle,
  Play,
  Search,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import {
  getHomeCategoryMeta,
  getHomePois,
  matchesHomePoiQuery,
  type HomeCategoryMeta,
  type HomeCity,
  type HomeCountry,
  type HomeMediaKind,
  type HomePoi,
} from "@/lib/home-survey";
import { easeConfirm, fadeUp, springSnappy, staggerContainer } from "@/components/motion/variants";

export const MIN_POI_PICKS = 3;

type MediaFilter = "all" | HomeMediaKind;
type SortMode = "curated" | "popular";

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

  // Filter state is reset on a new POI set by remounting via `key` from the parent.
  const [query, setQuery] = useState("");
  const [tokens, setTokens] = useState<string[]>([]);
  const [media, setMedia] = useState<MediaFilter>("all");
  const [sort, setSort] = useState<SortMode>("curated");
  const searchRef = useRef<HTMLInputElement | null>(null);

  const visiblePois = useMemo(() => {
    const filtered = pois.filter(
      (poi) =>
        (media === "all" || poi.media === media) &&
        tokens.every((token) => matchesHomePoiQuery(poi, token)) &&
        matchesHomePoiQuery(poi, query),
    );
    return sort === "popular" ? [...filtered].sort((a, b) => b.likes - a.likes) : filtered;
  }, [pois, media, tokens, query, sort]);

  // Tag suggestions: the most common tags on this wall, offered as one-tap
  // tokens while the search is still empty.
  const suggestedTags = useMemo(() => {
    const freq = new Map<string, number>();
    for (const poi of pois) for (const tag of poi.tags) freq.set(tag, (freq.get(tag) ?? 0) + 1);
    return [...freq.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([tag]) => tag)
      .filter((tag) => !tokens.includes(tag))
      .slice(0, 7);
  }, [pois, tokens]);

  // Pick order — Sets preserve insertion order, so the badge on each card can
  // show "which number pick" it is.
  const pickOrder = useMemo(() => new Map([...selectedIds].map((id, i) => [id, i + 1])), [selectedIds]);

  const count = selectedIds.size;
  const minPicks = Math.min(MIN_POI_PICKS, pois.length);
  const ready = count >= minPicks;
  const filtersActive = query.trim() !== "" || tokens.length > 0 || media !== "all" || sort !== "curated";

  // "/" anywhere focuses the search, like every modern command bar.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const addToken = (raw: string) => {
    const token = raw.trim().toLowerCase();
    if (!token) return;
    setTokens((prev) => (prev.includes(token) ? prev : [...prev, token]));
    setQuery("");
  };

  const removeToken = (token: string) => setTokens((prev) => prev.filter((t) => t !== token));

  const clearFilters = () => {
    setQuery("");
    setTokens([]);
    setMedia("all");
    setSort("curated");
  };

  const mediaOptions: { id: MediaFilter; label: string; icon?: typeof ImageIcon }[] = [
    { id: "all", label: zh ? "全部" : "All" },
    { id: "photo", label: zh ? "照片" : "Photos", icon: ImageIcon },
    { id: "video", label: zh ? "影片" : "Clips", icon: Play },
    { id: "insta", label: zh ? "貼文" : "Posts", icon: AtSign },
  ];

  return (
    <div id="home-poi-scene" className="mx-auto w-full max-w-6xl px-5 sm:px-8">
      {/* The scene builds top-down — toolbar, command bar, then the card
          stagger — so the arrival out of the earth dive reads as a cascade. */}
      <motion.div
        id="home-poi-toolbar"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.38, ease: easeConfirm }}
        className="mb-4 flex items-center justify-between gap-3"
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
        <p id="home-poi-counter" className="text-mono text-[13px] font-semibold text-[var(--text-muted)]">
          <span id="home-poi-counter-count" className={count > 0 ? "text-[var(--accent-line)]" : ""}>{count}</span>
          {zh ? ` 個已選 · 至少 ${minPicks} 個` : ` picked · at least ${minPicks}`}
        </p>
      </motion.div>

      {/* ─── Command bar: search, tokens, chips, media + sort ──────────────── */}
      <motion.div
        id="home-poi-filters"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.38, ease: easeConfirm, delay: 0.08 }}
        className="surface-glass mb-5 rounded-[1.4rem] border border-[var(--border-hairline)] p-2 shadow-[var(--shadow-raise)] transition-shadow duration-300 focus-within:border-[var(--border-strong)] focus-within:shadow-[var(--shadow-deep)]"
      >
        <div id="home-poi-search" className="flex items-center gap-2.5 px-2.5">
          <Search id="home-poi-search-icon" aria-hidden className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
          <input
            id="home-poi-search-input"
            ref={searchRef}
            type="search"
            inputMode="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && query.trim()) {
                e.preventDefault();
                addToken(query);
              } else if (e.key === "Backspace" && !query && tokens.length > 0) {
                removeToken(tokens[tokens.length - 1]);
              } else if (e.key === "Escape") {
                if (query) setQuery("");
                else e.currentTarget.blur();
              }
            }}
            placeholder={zh ? "搜尋關鍵字，按 Enter 固定成標籤…" : "Search keywords — Enter pins a tag…"}
            aria-label={zh ? "以關鍵字搜尋景點" : "Search spots by keyword"}
            className="h-11 w-full min-w-0 flex-1 bg-transparent text-[14.5px] text-[var(--text-primary)] outline-none [&::-webkit-search-cancel-button]:hidden placeholder:text-[var(--text-faint)]"
          />
          <span id="home-poi-search-count" className="text-mono shrink-0 whitespace-nowrap text-[12px] font-semibold text-[var(--text-muted)]">
            {visiblePois.length} {zh ? "個" : visiblePois.length === 1 ? "spot" : "spots"}
          </span>
          {query ? (
            <button
              id="home-poi-search-clear"
              type="button"
              onClick={() => setQuery("")}
              aria-label={zh ? "清除搜尋" : "Clear search"}
              className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[var(--text-muted)] transition hover:bg-[var(--surface-base)] hover:text-[var(--text-primary)]"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          ) : (
            <kbd
              id="home-poi-search-kbd"
              aria-hidden
              className="hidden h-6 min-w-6 shrink-0 place-items-center rounded-md border border-[var(--border-hairline)] bg-[var(--surface-raised)] px-1.5 text-[11px] font-bold text-[var(--text-faint)] sm:grid"
            >
              /
            </kbd>
          )}
          {filtersActive && (
            <button
              id="home-poi-filters-reset"
              type="button"
              onClick={clearFilters}
              className="inline-flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-[var(--text-primary)] px-2.5 text-[11.5px] font-bold text-[var(--surface-base)] transition hover:opacity-85"
            >
              <X className="h-3 w-3" aria-hidden />
              {zh ? "重設" : "Reset"}
            </button>
          )}
        </div>

        {/* Pinned tokens + tag suggestions */}
        {(tokens.length > 0 || suggestedTags.length > 0) && (
          <div id="home-poi-tokens" className="flex flex-wrap items-center gap-1.5 px-2.5 pb-2">
            <AnimatePresence initial={false}>
              {tokens.map((token) => (
                <motion.button
                  key={token}
                  id={`home-poi-token-${token}`}
                  type="button"
                  layout
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  transition={springSnappy}
                  onClick={() => removeToken(token)}
                  aria-label={zh ? `移除標籤 ${token}` : `Remove tag ${token}`}
                  className="inline-flex h-7 items-center gap-1 rounded-full bg-[var(--text-primary)] pl-2.5 pr-1.5 text-[12px] font-bold text-[var(--surface-base)]"
                >
                  #{token}
                  <X className="h-3 w-3 opacity-70" aria-hidden />
                </motion.button>
              ))}
            </AnimatePresence>
            {tokens.length === 0 && !query && (
              <>
                <span id="home-poi-suggest-label" className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-[var(--text-faint)]">
                  <Sparkles className="h-3 w-3" aria-hidden />
                  {zh ? "試試" : "Try"}
                </span>
                {suggestedTags.map((tag) => (
                  <button
                    key={tag}
                    id={`home-poi-suggest-${tag}`}
                    type="button"
                    onClick={() => addToken(tag)}
                    className="inline-flex h-7 items-center rounded-full border border-dashed border-[var(--border-strong)] px-2.5 text-[12px] font-semibold text-[var(--text-muted)] transition hover:border-solid hover:border-[var(--text-primary)] hover:text-[var(--text-primary)]"
                  >
                    #{tag}
                  </button>
                ))}
              </>
            )}
          </div>
        )}

        <div id="home-poi-filters-divider" aria-hidden className="mx-2.5 h-px bg-[var(--border-hairline)]" />

        {/* Filter rail: media kind · sort */}
        <div
          id="home-poi-rail"
          role="group"
          aria-label={zh ? "篩選" : "Filters"}
          className="flex flex-nowrap items-center gap-1.5 overflow-x-auto p-2 sm:flex-wrap sm:overflow-visible"
        >
          <div
            id="home-poi-media-segment"
            role="group"
            aria-label={zh ? "媒體類型" : "Media type"}
            className="flex h-9 shrink-0 items-center rounded-full border border-[var(--border-hairline)] bg-[var(--surface-raised)] p-0.5"
          >
            {mediaOptions.map((opt) => {
              const ActiveIcon = opt.icon;
              const active = media === opt.id;
              return (
                <button
                  key={opt.id}
                  id={`home-poi-media-${opt.id}`}
                  type="button"
                  onClick={() => setMedia(opt.id)}
                  aria-pressed={active}
                  title={opt.label}
                  className={`inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-bold transition ${
                    active
                      ? "bg-[var(--text-primary)] text-[var(--surface-base)]"
                      : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                  }`}
                >
                  {ActiveIcon && <ActiveIcon className="h-3.5 w-3.5" aria-hidden />}
                  <span className={ActiveIcon ? "hidden md:inline" : ""}>{opt.label}</span>
                </button>
              );
            })}
          </div>

          <button
            id="home-poi-sort"
            type="button"
            onClick={() => setSort((s) => (s === "popular" ? "curated" : "popular"))}
            aria-pressed={sort === "popular"}
            className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[12px] font-bold transition ${
              sort === "popular"
                ? "border-transparent bg-[var(--text-primary)] text-[var(--surface-base)]"
                : "border-[var(--border-hairline)] bg-[var(--surface-raised)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            }`}
          >
            <Flame className="h-3.5 w-3.5" aria-hidden />
            {zh ? "熱門優先" : "Popular"}
          </button>
        </div>
      </motion.div>

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
                <PoiCard
                  poi={poi}
                  zh={zh}
                  selected={selectedIds.has(poi.id)}
                  pickIndex={pickOrder.get(poi.id)}
                  onToggle={() => onToggle(poi.id)}
                />
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
          transition={{ ...springSnappy, delay: 0.25 }}
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

// ─── Cards ───────────────────────────────────────────────────────────────────

function PoiCard({
  poi,
  zh,
  selected,
  pickIndex,
  onToggle,
}: {
  poi: HomePoi;
  zh: boolean;
  selected: boolean;
  pickIndex?: number;
  onToggle: () => void;
}) {
  const name = zh ? poi.nameZh : poi.name;
  const categoryMeta = getHomeCategoryMeta(poi.category);
  return (
    <button
      id={`home-poi-card-${poi.id}`}
      type="button"
      onClick={onToggle}
      aria-pressed={selected}
      className={`group relative block w-full overflow-hidden rounded-2xl text-left transition-[transform,box-shadow] duration-300 [break-inside:avoid] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-line)] ${
        selected ? "scale-[0.985]" : "hover:-translate-y-1 hover:shadow-[var(--shadow-raise)]"
      }`}
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
      {/* Selected wash — a light accent tint over the whole card. */}
      <span
        id={`home-poi-card-wash-${poi.id}`}
        aria-hidden
        className={`pointer-events-none absolute inset-0 z-10 rounded-2xl bg-[var(--accent-line)] transition-opacity duration-200 ${
          selected ? "opacity-10" : "opacity-0"
        }`}
      />
      <motion.span
        id={`home-poi-card-check-${poi.id}`}
        aria-hidden
        initial={false}
        animate={selected ? { scale: 1, opacity: 1 } : { scale: 0.5, opacity: 0 }}
        transition={springSnappy}
        className="absolute right-2.5 top-2.5 z-20 grid h-7 min-w-7 place-items-center rounded-full bg-[var(--accent-line)] px-1 text-white shadow-[var(--accent-line-glow)]"
      >
        {/* Pick order — Sets keep insertion order, so this reads "3rd pick". */}
        {pickIndex != null ? (
          <span className="text-[12.5px] font-black leading-none">{pickIndex}</span>
        ) : (
          <Check className="h-4 w-4" strokeWidth={3} />
        )}
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

/** Likes · stay time · cost strip shared by photo and video captions. */
function CardStats({ poi, zh, id }: { poi: HomePoi; zh: boolean; id: string }) {
  return (
    <span id={id} className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] font-semibold text-white/80">
      <span className="inline-flex items-center gap-1">
        <Heart className="h-3 w-3 fill-white/80" aria-hidden />
        {formatCount(poi.likes)}
      </span>
      <span className="inline-flex items-center gap-1">
        <Clock className="h-3 w-3" aria-hidden />
        {formatStay(poi.stayMinutes, zh)}
      </span>
      <span>{formatCost(poi.costUsd, zh)}</span>
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
          className={`absolute inset-0 h-full w-full object-cover transition-[opacity,transform] duration-700 ${loaded ? "opacity-100" : "opacity-0"} ${
            kenburns && loaded ? "home-kenburns" : "group-hover:scale-[1.06]"
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
      <span
        id={`home-poi-photo-scrim-${poi.id}`}
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-black/80 via-black/30 to-transparent opacity-90 transition-opacity duration-300 group-hover:opacity-100"
      />
      <span id={`home-poi-photo-caption-${poi.id}`} className="absolute inset-x-0 bottom-0 p-3">
        <span id={`home-poi-photo-name-${poi.id}`} className="block text-[14.5px] font-bold leading-tight text-white">{name}</span>
        <span id={`home-poi-photo-meta-${poi.id}`} className="mt-1 flex flex-wrap items-center gap-1.5">
          <span id={`home-poi-photo-city-${poi.id}`} className="text-[11px] font-medium text-white/75">📍 {poi.city}</span>
          <CategoryTag id={`home-poi-photo-cat-${poi.id}`} meta={categoryMeta} zh={zh} />
        </span>
        <CardStats id={`home-poi-photo-stats-${poi.id}`} poi={poi} zh={zh} />
        {/* One-line teaser that slides open on hover. */}
        <span
          id={`home-poi-photo-blurb-${poi.id}`}
          className="block max-h-0 overflow-hidden text-[11.5px] leading-snug text-white/75 opacity-0 transition-all duration-300 group-hover:mt-1 group-hover:max-h-16 group-hover:opacity-100"
        >
          {zh ? poi.blurbZh : poi.blurb}
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
      <span id={`home-poi-video-scrim-${poi.id}`} aria-hidden className="absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-black/25" />
      <span id={`home-poi-video-live-${poi.id}`} className="absolute left-2.5 top-2.5 flex items-center gap-1.5 rounded-full bg-black/45 px-2 py-1 text-[10px] font-bold tracking-wide text-white backdrop-blur-sm">
        <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
        0:{String(secs).padStart(2, "0")}
      </span>
      <span
        id={`home-poi-video-play-${poi.id}`}
        aria-hidden
        className="absolute left-1/2 top-1/2 grid h-12 w-12 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white/20 ring-1 ring-white/30 backdrop-blur-md transition-all duration-200 group-hover:scale-110 group-hover:bg-white/30"
      >
        <Play className="h-5 w-5 fill-white text-white" />
      </span>
      <span id={`home-poi-video-caption-${poi.id}`} className="absolute inset-x-0 bottom-0 p-3">
        <span id={`home-poi-video-name-${poi.id}`} className="block text-[14.5px] font-bold leading-tight text-white">{name}</span>
        <span id={`home-poi-video-meta-${poi.id}`} className="mt-1 flex flex-wrap items-center gap-1.5">
          <span id={`home-poi-video-city-${poi.id}`} className="text-[11px] font-medium text-white/75">🎬 {poi.city}</span>
          <CategoryTag id={`home-poi-video-cat-${poi.id}`} meta={categoryMeta} zh={zh} />
        </span>
        <CardStats id={`home-poi-video-stats-${poi.id}`} poi={poi} zh={zh} />
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

'use client'

// ─────────────────────────────────────────────────────────────────────────────
// PoiScene — phase 2 of the index-page survey pipeline.
//
// The selected country's POIs take over the stage as a media wall: photo
// cards, faux-video tiles (Ken Burns + runtime chrome) and Instagram-styled
// posts. Real photos stream in from /api/home/poi-photo (Google Places via a
// keyless proxy); every card is born with a deterministic gradient + emoji
// placeholder so the wall looks designed even with zero connectivity.
// Visitors multi-select cards, then submit to wake the AI planner.
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from "react";
import { motion } from "motion/react";
import { ArrowRight, Bookmark, Check, ChevronLeft, Heart, MessageCircle, Play, Send } from "lucide-react";
import { getHomePois, type HomeCountry, type HomePoi } from "@/lib/home-survey";
import { fadeUp, springSnappy, staggerContainer } from "@/components/motion/variants";

export const MIN_POI_PICKS = 3;

interface PoiSceneProps {
  country: HomeCountry;
  locale: "en" | "zh-TW";
  selectedIds: ReadonlySet<string>;
  onToggle: (id: string) => void;
  onSubmit: () => void;
  onBack: () => void;
}

export default function PoiScene({ country, locale, selectedIds, onToggle, onSubmit, onBack }: PoiSceneProps) {
  const zh = locale === "zh-TW";
  const pois = getHomePois(country.code);
  const count = selectedIds.size;
  const ready = count >= MIN_POI_PICKS;

  return (
    <div id="home-poi-scene" className="mx-auto w-full max-w-6xl px-5 sm:px-8">
      <div id="home-poi-toolbar" className="mb-5 flex items-center justify-between gap-3">
        <button
          id="home-poi-back"
          type="button"
          onClick={onBack}
          className="inline-flex h-9 items-center gap-1 rounded-full border border-[var(--border-hairline)] bg-[var(--surface-raised)] px-3.5 text-[13px] font-semibold text-[var(--text-muted)] transition hover:text-[var(--text-primary)]"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
          {zh ? "重選國家" : "Change country"}
        </button>
        <p id="home-poi-counter" className="text-mono text-[13px] font-semibold text-[var(--text-muted)]">
          <span id="home-poi-counter-count" className={count > 0 ? "text-[var(--accent-line)]" : ""}>{count}</span>
          {zh ? ` 個已選 · 至少 ${MIN_POI_PICKS} 個` : ` picked · at least ${MIN_POI_PICKS}`}
        </p>
      </div>

      <motion.div
        id="home-poi-grid"
        variants={staggerContainer}
        initial="hidden"
        animate="show"
        className="columns-2 gap-3 pb-32 sm:gap-4 md:columns-3 xl:columns-4 [&>*]:mb-3 sm:[&>*]:mb-4"
      >
        {pois.map((poi) => (
          <motion.div key={poi.id} variants={fadeUp}>
            <PoiCard poi={poi} zh={zh} selected={selectedIds.has(poi.id)} onToggle={() => onToggle(poi.id)} />
          </motion.div>
        ))}
      </motion.div>

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
                ? `再選 ${MIN_POI_PICKS - count} 個`
                : `Pick ${MIN_POI_PICKS - count} more`}
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

// ─── Cards ───────────────────────────────────────────────────────────────────

function PoiCard({ poi, zh, selected, onToggle }: { poi: HomePoi; zh: boolean; selected: boolean; onToggle: () => void }) {
  const name = zh ? poi.nameZh : poi.name;
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

      {poi.media === "insta" ? <InstaCard poi={poi} name={name} zh={zh} /> : poi.media === "video" ? <VideoCard poi={poi} name={name} /> : <PhotoCard poi={poi} name={name} />}
    </button>
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

function PhotoCard({ poi, name }: { poi: HomePoi; name: string }) {
  return (
    <span id={`home-poi-photo-${poi.id}`} className="relative block">
      <MediaImage poi={poi} className="aspect-[4/5] w-full" />
      <span id={`home-poi-photo-scrim-${poi.id}`} aria-hidden className="absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-black/70 to-transparent" />
      <span id={`home-poi-photo-caption-${poi.id}`} className="absolute inset-x-0 bottom-0 p-3">
        <span id={`home-poi-photo-name-${poi.id}`} className="block text-[14px] font-bold leading-tight text-white">{name}</span>
        <span id={`home-poi-photo-city-${poi.id}`} className="mt-0.5 block text-[11px] font-medium text-white/75">📍 {poi.city}</span>
      </span>
    </span>
  );
}

function VideoCard({ poi, name }: { poi: HomePoi; name: string }) {
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
        <span id={`home-poi-video-city-${poi.id}`} className="mt-0.5 block text-[11px] font-medium text-white/75">🎬 {poi.city}</span>
      </span>
    </span>
  );
}

function InstaCard({ poi, name, zh }: { poi: HomePoi; name: string; zh: boolean }) {
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
      <MediaImage poi={poi} className="aspect-square w-full" />
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

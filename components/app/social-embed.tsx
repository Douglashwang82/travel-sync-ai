"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { detectSocial, type SocialMatch } from "@/lib/social/detect";
import { loadAndReprocess } from "@/lib/social/load-embed-script";

interface Props {
  url: string;
  className?: string;
  /** Render fallback children if the URL isn't a recognised social URL. */
  fallback?: React.ReactNode;
}

/**
 * Renders an inline embed for Instagram, Threads, Facebook, or YouTube
 * URLs. Falls back to `fallback` (or null) when the URL doesn't match.
 *
 * The expensive embed scripts (Instagram, Threads) are only fetched once
 * per page and only after the card scrolls into view.
 */
export function SocialEmbed({ url, className, fallback = null }: Props) {
  const match = detectSocial(url);
  if (!match) return <>{fallback}</>;

  switch (match.platform) {
    case "youtube":
      return <YouTubeEmbed match={match} className={className} />;
    case "facebook":
      return <FacebookEmbed match={match} className={className} />;
    case "instagram":
      return <InstagramEmbed match={match} className={className} />;
    case "threads":
      return <ThreadsEmbed match={match} className={className} />;
  }
}

function YouTubeEmbed({ match, className }: { match: SocialMatch; className?: string }) {
  return (
    <div className={cn("relative w-full overflow-hidden rounded-[var(--radius-md)] bg-black", className)}
         style={{ aspectRatio: "16 / 9" }}>
      <iframe
        src={`https://www.youtube.com/embed/${match.id}`}
        title="YouTube video"
        loading="lazy"
        allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
        className="absolute inset-0 h-full w-full border-0"
      />
    </div>
  );
}

function FacebookEmbed({ match, className }: { match: SocialMatch; className?: string }) {
  const src =
    `https://www.facebook.com/plugins/post.php?` +
    `href=${encodeURIComponent(match.permalink)}&show_text=true&width=500`;
  return (
    <div className={cn("w-full overflow-hidden rounded-[var(--radius-md)] bg-white", className)}>
      <iframe
        src={src}
        title="Facebook post"
        loading="lazy"
        scrolling="no"
        allow="encrypted-media; web-share"
        allowFullScreen
        className="block h-[560px] w-full border-0"
      />
    </div>
  );
}

function useLazyMount(ref: React.RefObject<HTMLElement | null>) {
  // Browsers without IntersectionObserver (or SSR after hydration) skip the
  // lazy gate entirely — initialize via the lazy-state callback to avoid
  // setState-in-effect ping-pong.
  const [visible, setVisible] = useState(
    () => typeof IntersectionObserver === "undefined",
  );
  useEffect(() => {
    if (visible) return;
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          obs.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [ref, visible]);
  return visible;
}

function InstagramEmbed({ match, className }: { match: SocialMatch; className?: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const visible = useLazyMount(hostRef);

  useEffect(() => {
    if (!visible) return;
    void loadAndReprocess("instagram").catch(() => {});
  }, [visible]);

  return (
    <div ref={hostRef} className={cn("w-full", className)}>
      {visible ? (
        <blockquote
          className="instagram-media"
          data-instgrm-captioned
          data-instgrm-permalink={match.permalink}
          data-instgrm-version="14"
          style={{
            background: "#FFF",
            border: 0,
            borderRadius: 3,
            margin: 0,
            maxWidth: 540,
            minWidth: 280,
            padding: 0,
            width: "100%",
          }}
        >
          <a href={match.permalink} target="_blank" rel="noopener noreferrer">
            View on Instagram
          </a>
        </blockquote>
      ) : (
        <EmbedSkeleton href={match.permalink} label="Instagram post" />
      )}
    </div>
  );
}

function ThreadsEmbed({ match, className }: { match: SocialMatch; className?: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const visible = useLazyMount(hostRef);

  useEffect(() => {
    if (!visible) return;
    void loadAndReprocess("threads").catch(() => {});
  }, [visible]);

  return (
    <div ref={hostRef} className={cn("w-full", className)}>
      {visible ? (
        <blockquote
          className="text-post-media"
          data-text-post-permalink={match.permalink}
          data-text-post-version="0"
          style={{ margin: 0, maxWidth: 540, width: "100%" }}
        >
          <a href={match.permalink} target="_blank" rel="noopener noreferrer">
            View on Threads
          </a>
        </blockquote>
      ) : (
        <EmbedSkeleton href={match.permalink} label="Threads post" />
      )}
    </div>
  );
}

function EmbedSkeleton({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex h-32 w-full items-center justify-center rounded-[var(--radius-md)] border border-dashed border-[var(--border-hairline)] bg-[var(--surface-sunken)] text-xs text-[var(--text-muted)] hover:border-[var(--accent-line)]"
    >
      Loading {label}…
    </a>
  );
}

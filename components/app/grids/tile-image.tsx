"use client";

import { useState, type CSSProperties } from "react";
import { cn } from "@/lib/utils";
import type { ItemType } from "@/lib/types";

/**
 * Build the URL for the `/api/app/places/photo/...` proxy, which streams a
 * Google Places photo without leaking the API key. `photoName` is the
 * Places resource path (e.g. `places/{id}/photos/{photoId}`).
 */
export function placePhotoProxyUrl(
  photoName: string,
  opts: { w?: number; h?: number } = {},
): string {
  const params = new URLSearchParams();
  if (opts.w) params.set("w", String(opts.w));
  if (opts.h) params.set("h", String(opts.h));
  const qs = params.toString();
  return `/api/app/places/photo/${photoName}${qs ? `?${qs}` : ""}`;
}

const TYPE_EMOJI: Record<ItemType, string> = {
  hotel: "🏨",
  restaurant: "🍽️",
  activity: "🎯",
  transport: "🚌",
  flight: "✈️",
  insurance: "🛡️",
  other: "📌",
};

type Shape = "thumb" | "square" | "cover" | "background";

/**
 * Uniform image renderer for bento tiles. Picks the first usable source from
 * (1) an explicit `src`, (2) a Places `photoName` resolved through the
 * server proxy, then falls back to an emoji-on-surface placeholder keyed on
 * `itemType`. Uses `<img>` rather than `next/image` because tile image
 * hosts are open-ended (Places, LINE CDN, OG images) and would otherwise
 * each require a `next.config` remotePatterns entry.
 */
export function TileImage({
  src,
  photoName,
  itemType,
  alt = "",
  shape = "thumb",
  className,
  style,
  size,
}: {
  src?: string | null;
  photoName?: string | null;
  itemType?: ItemType;
  alt?: string;
  shape?: Shape;
  className?: string;
  style?: CSSProperties;
  /** Hint passed to the Places photo proxy; matched to the rendered size. */
  size?: { w?: number; h?: number };
}) {
  const [errored, setErrored] = useState(false);

  const resolved =
    !errored && src
      ? src
      : !errored && photoName
        ? placePhotoProxyUrl(photoName, { w: size?.w, h: size?.h })
        : null;

  const shapeClass =
    shape === "thumb"
      ? "h-16 w-16 shrink-0 rounded-[var(--radius-sm)]"
      : shape === "square"
        ? "aspect-square w-full rounded-[var(--radius-md)]"
        : shape === "cover"
          ? "aspect-[16/9] w-full rounded-[var(--radius-md)]"
          : "absolute inset-0 h-full w-full";

  if (resolved) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={resolved}
        alt={alt}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setErrored(true)}
        className={cn("object-cover", shapeClass, className)}
        style={style}
      />
    );
  }

  const emoji = (itemType && TYPE_EMOJI[itemType]) || "📌";
  return (
    <div
      aria-hidden
      className={cn(
        "flex items-center justify-center bg-[var(--surface-sunken)] text-2xl text-[var(--text-faint)]",
        shapeClass,
        className,
      )}
      style={style}
    >
      <span>{emoji}</span>
    </div>
  );
}

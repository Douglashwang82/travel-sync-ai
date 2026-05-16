export type SocialPlatform = "instagram" | "threads" | "facebook" | "youtube";

export interface SocialMatch {
  platform: SocialPlatform;
  /** Canonical permalink to pass to the platform embed (always https). */
  permalink: string;
  /** Platform-specific resource id when extractable (YouTube video id, etc). */
  id?: string;
}

const INSTAGRAM_PATH = /^\/(p|reel|tv)\/([A-Za-z0-9_-]+)/;
const THREADS_PATH = /^\/@[^/]+\/post\/([A-Za-z0-9_-]+)/;
const YOUTUBE_ID = /^[A-Za-z0-9_-]{6,}$/;

export function detectSocial(rawUrl: string): SocialMatch | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;

  const host = url.hostname.replace(/^www\./, "").toLowerCase();

  if (host === "youtube.com" || host === "m.youtube.com") {
    const v = url.searchParams.get("v");
    if (v && YOUTUBE_ID.test(v)) {
      return { platform: "youtube", permalink: `https://www.youtube.com/watch?v=${v}`, id: v };
    }
    const shorts = url.pathname.match(/^\/shorts\/([A-Za-z0-9_-]+)/);
    if (shorts) {
      return { platform: "youtube", permalink: `https://www.youtube.com/watch?v=${shorts[1]}`, id: shorts[1] };
    }
    const embed = url.pathname.match(/^\/embed\/([A-Za-z0-9_-]+)/);
    if (embed) {
      return { platform: "youtube", permalink: `https://www.youtube.com/watch?v=${embed[1]}`, id: embed[1] };
    }
    return null;
  }
  if (host === "youtu.be") {
    const id = url.pathname.slice(1).split("/")[0];
    if (id && YOUTUBE_ID.test(id)) {
      return { platform: "youtube", permalink: `https://www.youtube.com/watch?v=${id}`, id };
    }
    return null;
  }

  if (host === "instagram.com") {
    const m = url.pathname.match(INSTAGRAM_PATH);
    if (!m) return null;
    return {
      platform: "instagram",
      permalink: `https://www.instagram.com/${m[1]}/${m[2]}/`,
      id: m[2],
    };
  }

  if (host === "threads.net" || host === "threads.com") {
    const m = url.pathname.match(THREADS_PATH);
    if (!m) return null;
    // Preserve original handle so Threads renders the right author header.
    return {
      platform: "threads",
      permalink: `https://www.threads.net${url.pathname.replace(/\/$/, "")}/`,
      id: m[1],
    };
  }

  if (host === "facebook.com" || host === "m.facebook.com" || host === "fb.watch") {
    // Facebook's plugin renderer accepts the full canonical URL; we just
    // need to know it's a Facebook URL so we can hand it to the iframe.
    return { platform: "facebook", permalink: url.toString() };
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tracking List — source fetchers
//
// One fetcher per TrackingSourceType. Each returns a normalised FetchedItem[]
// and a content hash for change detection. Fetchers MUST NOT call the LLM —
// they only produce raw/structured text for the extractor stage.
// ─────────────────────────────────────────────────────────────────────────────

import { createHash } from "node:crypto";
import type { FetchedItem, TrackingSourceType } from "./types";

export interface FetchResult {
  items: FetchedItem[];
  content_hash: string;
  raw_excerpt: string;
  http_status: number;
}

export type Fetcher = (url: string) => Promise<FetchResult>;

// ─── Website fetcher (MVP) ───────────────────────────────────────────────────
// Raw fetch + conservative HTML → text cleanup. One page = one FetchedItem;
// the LLM extractor is responsible for splitting a listing page into multiple
// concrete items. No HTML parser dep — keeps bundle small on Vercel.

const MAX_BODY_BYTES = 2_000_000;          // 2 MB ceiling per page
const MAX_TEXT_CHARS = 40_000;             // fed to LLM (≈ 10k tokens ceiling)
const EXCERPT_CHARS  = 8_000;              // stored for debugging
const FETCH_TIMEOUT_MS = 15_000;

async function fetchWebsite(url: string): Promise<FetchResult> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, {
      signal: ac.signal,
      redirect: "follow",
      headers: {
        "user-agent": "TravelSyncAI/1.0 (+https://travel-sync-ai.vercel.app)",
        "accept": "text/html,application/xhtml+xml",
        "accept-language": "zh-TW,zh;q=0.9,en;q=0.8",
      },
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    return {
      items: [],
      content_hash: "",
      raw_excerpt: `HTTP ${res.status} ${res.statusText}`,
      http_status: res.status,
    };
  }

  const buf = await res.arrayBuffer();
  const capped = buf.byteLength > MAX_BODY_BYTES
    ? buf.slice(0, MAX_BODY_BYTES)
    : buf;
  const html = new TextDecoder("utf-8", { fatal: false }).decode(capped);

  const title = matchOne(html, /<title[^>]*>([\s\S]*?)<\/title>/i) ?? url;
  const metaDesc =
    matchOne(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ??
    matchOne(html, /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);
  const ogImage =
    matchOne(html, /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);

  const text = htmlToText(html).slice(0, MAX_TEXT_CHARS);
  const body_text = [title.trim(), metaDesc?.trim(), text]
    .filter(Boolean)
    .join("\n\n");

  const content_hash = sha256(body_text);

  return {
    items: [
      {
        external_id: null,          // per-item ids come from the extractor
        title: decodeEntities(title).trim().slice(0, 500),
        url,
        image_url: ogImage ? absolutize(url, ogImage) : null,
        body_text,
        published_at: null,
      },
    ],
    content_hash,
    raw_excerpt: body_text.slice(0, EXCERPT_CHARS),
    http_status: res.status,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function matchOne(s: string, re: RegExp): string | null {
  const m = s.match(re);
  return m ? decodeEntities(m[1]) : null;
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .split("\n")
    .map((line) => decodeEntities(line).replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));
}

function absolutize(base: string, maybeRelative: string): string {
  try {
    return new URL(maybeRelative, base).toString();
  } catch {
    return maybeRelative;
  }
}

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

// ─── RSS / Atom fetcher ──────────────────────────────────────────────────────
// Feeds are structurally regular, so a focused regex extractor is sufficient
// and avoids adding an XML parser dependency. Handles both RSS 2.0 (<item>)
// and Atom (<entry>). Up to MAX_FEED_ITEMS per feed.

const MAX_FEED_ITEMS = 30;

async function fetchRss(url: string): Promise<FetchResult> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, {
      signal: ac.signal,
      redirect: "follow",
      headers: {
        "user-agent": "TravelSyncAI/1.0 (+https://travel-sync-ai.vercel.app)",
        "accept": "application/rss+xml,application/atom+xml,application/xml,text/xml;q=0.9",
      },
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    return {
      items: [],
      content_hash: "",
      raw_excerpt: `HTTP ${res.status} ${res.statusText}`,
      http_status: res.status,
    };
  }

  const buf = await res.arrayBuffer();
  const capped = buf.byteLength > MAX_BODY_BYTES ? buf.slice(0, MAX_BODY_BYTES) : buf;
  const xml = new TextDecoder("utf-8", { fatal: false }).decode(capped);

  const isAtom = /<feed\b/i.test(xml) && !/<rss\b/i.test(xml);
  const itemTag = isAtom ? "entry" : "item";
  const blocks = extractBlocks(xml, itemTag).slice(0, MAX_FEED_ITEMS);

  const items: FetchedItem[] = blocks.map((block) => parseFeedItem(block, isAtom, url));

  // Hash only the stable identity of each item so transient re-orderings or
  // cosmetic re-renders don't force a re-extract.
  const hashInput = items
    .map((it) => it.external_id ?? it.url ?? it.title)
    .sort()
    .join("\n");
  const content_hash = hashInput ? sha256(hashInput) : "";

  return {
    items,
    content_hash,
    raw_excerpt: xml.slice(0, EXCERPT_CHARS),
    http_status: res.status,
  };
}

function extractBlocks(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "gi");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(m[1]);
  return out;
}

function parseFeedItem(block: string, isAtom: boolean, feedUrl: string): FetchedItem {
  const title = decodeEntities(stripCdata(matchTag(block, "title") ?? "")).trim();

  let link: string | null = null;
  if (isAtom) {
    const hrefMatch = block.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*\/?>/i);
    link = hrefMatch ? hrefMatch[1] : null;
  } else {
    link = matchTag(block, "link");
  }
  const url = link ? absolutize(feedUrl, stripCdata(link).trim()) : null;

  const rawId =
    matchTag(block, isAtom ? "id" : "guid") ??
    url ??
    title;
  const external_id = stripCdata(rawId).trim() || null;

  const pub =
    matchTag(block, isAtom ? "published" : "pubDate") ??
    matchTag(block, "updated") ??
    null;
  const published_at = pub ? isoDate(pub) : null;

  const rawBody =
    matchTag(block, isAtom ? "content" : "content:encoded") ??
    matchTag(block, isAtom ? "summary" : "description") ??
    "";
  const body_text = [title, htmlToText(stripCdata(rawBody))]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 8_000);

  return {
    external_id,
    title: title || url || "(untitled)",
    url,
    image_url: null,
    body_text,
    published_at,
  };
}

function matchTag(block: string, tag: string): string | null {
  // Escape the colon in namespaced tags like content:encoded.
  const escaped = tag.replace(/:/g, "\\:");
  const m = block.match(new RegExp(`<${escaped}\\b[^>]*>([\\s\\S]*?)</${escaped}>`, "i"));
  return m ? m[1] : null;
}

function stripCdata(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
}

function isoDate(raw: string): string | null {
  const t = Date.parse(raw.trim());
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

// ─── YouTube Data API fetcher ────────────────────────────────────────────────
// Uses the uploads playlist trick: for any channel with ID "UCxxx", its
// uploads playlist is "UUxxx". That lets us skip channels.list entirely
// when a channel ID is already in the URL, saving quota. For @handles and
// legacy /c/ or /user/ URLs we call channels.list once to resolve.
//
// Quota budget per run:
//   - Direct channel ID URL: 1 unit (playlistItems.list)
//   - Handle / username URL: 2 units (channels.list + playlistItems.list)
// Free quota is 10,000 units/day — plenty for hundreds of subscribers.

const YT_MAX_RESULTS = 25;

type YtUrlId =
  | { kind: "channel"; channelId: string }
  | { kind: "handle"; handle: string }
  | { kind: "username"; username: string };

export function parseYouTubeUrl(raw: string): YtUrlId | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (!/(^|\.)youtube\.com$/i.test(u.hostname) && u.hostname.toLowerCase() !== "youtu.be") {
    return null;
  }

  const path = u.pathname.replace(/\/+$/, "");
  const segs = path.split("/").filter(Boolean);

  // /channel/UCxxx
  if (segs[0] === "channel" && segs[1]?.startsWith("UC")) {
    return { kind: "channel", channelId: segs[1] };
  }
  // /@handle or @handle/videos
  if (segs[0]?.startsWith("@")) {
    return { kind: "handle", handle: segs[0].slice(1) };
  }
  // /c/customname
  if (segs[0] === "c" && segs[1]) {
    return { kind: "handle", handle: segs[1] };
  }
  // /user/legacyname
  if (segs[0] === "user" && segs[1]) {
    return { kind: "username", username: segs[1] };
  }
  return null;
}

async function resolveUploadsPlaylist(apiKey: string, id: YtUrlId): Promise<string | null> {
  if (id.kind === "channel") {
    // uploads playlist is UU + <channel id without UC prefix>
    return "UU" + id.channelId.slice(2);
  }

  const params = new URLSearchParams({ part: "contentDetails", key: apiKey });
  if (id.kind === "handle") params.set("forHandle", `@${id.handle}`);
  else params.set("forUsername", id.username);

  const res = await fetch(`https://www.googleapis.com/youtube/v3/channels?${params}`);
  if (!res.ok) return null;
  const json = (await res.json()) as {
    items?: Array<{ contentDetails?: { relatedPlaylists?: { uploads?: string } } }>;
  };
  return json.items?.[0]?.contentDetails?.relatedPlaylists?.uploads ?? null;
}

async function fetchYouTube(url: string): Promise<FetchResult> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) throw new Error("YOUTUBE_API_KEY is not set");

  const id = parseYouTubeUrl(url);
  if (!id) {
    return { items: [], content_hash: "", raw_excerpt: "unrecognised YouTube URL", http_status: 400 };
  }

  const uploads = await resolveUploadsPlaylist(apiKey, id);
  if (!uploads) {
    return { items: [], content_hash: "", raw_excerpt: "channel not found or quota exhausted", http_status: 404 };
  }

  const params = new URLSearchParams({
    part: "snippet,contentDetails",
    playlistId: uploads,
    maxResults: String(YT_MAX_RESULTS),
    key: apiKey,
  });
  const res = await fetch(`https://www.googleapis.com/youtube/v3/playlistItems?${params}`);
  if (!res.ok) {
    return {
      items: [],
      content_hash: "",
      raw_excerpt: `HTTP ${res.status} ${res.statusText}`,
      http_status: res.status,
    };
  }

  type PlaylistItem = {
    snippet?: {
      title?: string;
      description?: string;
      publishedAt?: string;
      resourceId?: { videoId?: string };
      thumbnails?: { high?: { url?: string }; default?: { url?: string } };
    };
    contentDetails?: { videoId?: string; videoPublishedAt?: string };
  };
  const json = (await res.json()) as { items?: PlaylistItem[] };
  const raw = json.items ?? [];

  const items: FetchedItem[] = raw
    .map((it): FetchedItem | null => {
      const videoId = it.contentDetails?.videoId ?? it.snippet?.resourceId?.videoId;
      if (!videoId) return null;
      const title = (it.snippet?.title ?? "").trim();
      const description = (it.snippet?.description ?? "").trim();
      const published =
        it.contentDetails?.videoPublishedAt ??
        it.snippet?.publishedAt ??
        null;
      const thumb =
        it.snippet?.thumbnails?.high?.url ?? it.snippet?.thumbnails?.default?.url ?? null;
      return {
        external_id: `yt:${videoId}`,
        title: title || `YouTube video ${videoId}`,
        url: `https://www.youtube.com/watch?v=${videoId}`,
        image_url: thumb,
        body_text: [title, description].filter(Boolean).join("\n\n").slice(0, 4_000),
        published_at: published ? new Date(published).toISOString() : null,
      };
    })
    .filter((v): v is FetchedItem => v !== null);

  const content_hash = items.length
    ? sha256(items.map((i) => i.external_id).sort().join("\n"))
    : "";

  return {
    items,
    content_hash,
    raw_excerpt: `youtube ${id.kind} — ${items.length} videos`,
    http_status: 200,
  };
}

// ─── Instagram fetcher (Meta Graph API, Business Discovery) ──────────────────
// Business Discovery lets our own IG Business/Creator account read any PUBLIC
// Business/Creator account's media — no per-target OAuth required. Personal
// accounts are not discoverable; we surface that as a clear error so the user
// knows to pick a Business/Creator source instead.
//
// Env:
//   META_IG_BUSINESS_ACCOUNT_ID — our IG Business Account ID (the "caller")
//   META_GRAPH_TOKEN           — long-lived page access token with
//                                 instagram_basic + pages_show_list scopes
// Docs: https://developers.facebook.com/docs/instagram-api/guides/business-discovery
//
// Quota: each business_discovery query counts toward the caller account's
// rate limits (~200 calls/hour/user). With a small subscriber base that's
// well within budget.

const IG_MAX_RESULTS = 25;
const META_GRAPH_VERSION = "v20.0";

// Reserved first-path segments that are NOT usernames.
const IG_RESERVED = new Set([
  "explore", "accounts", "p", "reel", "reels", "stories", "tv", "direct",
  "about", "developer", "press", "legal", "privacy", "terms",
]);

export function parseInstagramUrl(raw: string): { username: string } | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (!/(^|\.)instagram\.com$/i.test(u.hostname)) return null;

  const segs = u.pathname.split("/").filter(Boolean);
  if (segs.length === 0) return null;
  const first = segs[0].toLowerCase();
  if (IG_RESERVED.has(first)) return null;
  // Usernames are 1–30 chars, letters/numbers/periods/underscores.
  if (!/^[a-z0-9._]{1,30}$/i.test(segs[0])) return null;
  return { username: segs[0] };
}

async function fetchInstagram(url: string): Promise<FetchResult> {
  const igAccountId = process.env.META_IG_BUSINESS_ACCOUNT_ID;
  const token = process.env.META_GRAPH_TOKEN;
  if (!igAccountId || !token) {
    throw new Error("META_IG_BUSINESS_ACCOUNT_ID and META_GRAPH_TOKEN must be set");
  }

  const parsed = parseInstagramUrl(url);
  if (!parsed) {
    return {
      items: [],
      content_hash: "",
      raw_excerpt: "unrecognised Instagram URL",
      http_status: 400,
    };
  }

  const mediaFields = "id,caption,media_type,media_url,permalink,timestamp,thumbnail_url";
  const bd = `business_discovery.username(${parsed.username}){username,name,media.limit(${IG_MAX_RESULTS}){${mediaFields}}}`;
  const endpoint =
    `https://graph.facebook.com/${META_GRAPH_VERSION}/${igAccountId}` +
    `?fields=${encodeURIComponent(bd)}&access_token=${encodeURIComponent(token)}`;

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(endpoint, { signal: ac.signal });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    // Meta returns 400 with a specific sub-code when target isn't a
    // Business/Creator account — surface a friendlier excerpt.
    const friendly = /not a business/i.test(body)
      ? `@${parsed.username} is not an Instagram Business/Creator account (Business Discovery only reads those).`
      : `HTTP ${res.status} ${body.slice(0, 400)}`;
    return {
      items: [],
      content_hash: "",
      raw_excerpt: friendly,
      http_status: res.status,
    };
  }

  type Media = {
    id: string;
    caption?: string;
    media_type?: string;
    media_url?: string;
    permalink?: string;
    timestamp?: string;
    thumbnail_url?: string;
  };
  type BdResponse = {
    business_discovery?: {
      username?: string;
      name?: string;
      media?: { data?: Media[] };
    };
  };
  const json = (await res.json()) as BdResponse;
  const media = json.business_discovery?.media?.data ?? [];

  const items: FetchedItem[] = media
    .filter((m) => m.id && (m.permalink || m.media_url))
    .map((m) => {
      const caption = (m.caption ?? "").trim();
      const title = caption.split("\n")[0].slice(0, 200) || `@${parsed.username} post`;
      const image =
        m.media_type === "VIDEO" ? m.thumbnail_url ?? m.media_url ?? null : m.media_url ?? null;
      return {
        external_id: `ig:${m.id}`,
        title,
        url: m.permalink ?? m.media_url ?? null,
        image_url: image ?? null,
        body_text: caption.slice(0, 4_000),
        published_at: m.timestamp ? new Date(m.timestamp).toISOString() : null,
      } satisfies FetchedItem;
    });

  const content_hash = items.length
    ? sha256(items.map((i) => i.external_id).sort().join("\n"))
    : "";

  return {
    items,
    content_hash,
    raw_excerpt: `instagram @${parsed.username} — ${items.length} posts`,
    http_status: 200,
  };
}

// ─── Threads fetcher ────────────────────────────────────────────────────────
// The official Threads API (Meta) is OAuth-only: it can read accounts that
// have granted our app access, but there is no public "business discovery"
// equivalent. Reading arbitrary public Threads profiles via the official
// API is not possible today, so we fail loudly rather than silently.
// Re-enable when Meta ships a discovery endpoint.

export function parseThreadsUrl(raw: string): { username: string } | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (!/(^|\.)threads\.(net|com)$/i.test(u.hostname)) return null;

  const segs = u.pathname.split("/").filter(Boolean);
  if (segs.length === 0) return null;
  const first = segs[0];
  if (!first.startsWith("@")) return null;
  const handle = first.slice(1);
  if (!/^[a-z0-9._]{1,30}$/i.test(handle)) return null;
  return { username: handle };
}

async function fetchThreads(_url: string): Promise<FetchResult> {
  throw new Error(
    "Threads tracking is not supported: Meta's Threads API has no public business-discovery endpoint, only per-account OAuth."
  );
}

// Exported only for unit tests.
export const __test = {
  htmlToText,
  decodeEntities,
  absolutize,
  sha256,
  parseFeedItem,
  extractBlocks,
  parseYouTubeUrl,
  parseInstagramUrl,
  parseThreadsUrl,
};

// ─── Registry ────────────────────────────────────────────────────────────────

const notImplemented: Fetcher = async () => {
  throw new Error("fetcher not implemented for this source type yet");
};

export const fetchers: Record<TrackingSourceType, Fetcher> = {
  website: fetchWebsite,
  rss: fetchRss,
  instagram: fetchInstagram,
  threads: fetchThreads,
  x: notImplemented,
  youtube: fetchYouTube,
  tiktok: notImplemented,
};

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

// Exported only for unit tests.
export const __test = {
  htmlToText,
  decodeEntities,
  absolutize,
  sha256,
  parseFeedItem,
  extractBlocks,
};

// ─── Registry ────────────────────────────────────────────────────────────────

const notImplemented: Fetcher = async () => {
  throw new Error("fetcher not implemented for this source type yet");
};

export const fetchers: Record<TrackingSourceType, Fetcher> = {
  website: fetchWebsite,
  rss: fetchRss,
  instagram: notImplemented,
  threads: notImplemented,
  x: notImplemented,
  youtube: notImplemented,
  tiktok: notImplemented,
};

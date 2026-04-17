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

// Exported only for unit tests.
export const __test = { htmlToText, decodeEntities, absolutize, sha256 };

// ─── Registry ────────────────────────────────────────────────────────────────

const notImplemented: Fetcher = async () => {
  throw new Error("fetcher not implemented for this source type yet");
};

export const fetchers: Record<TrackingSourceType, Fetcher> = {
  website: fetchWebsite,
  rss: notImplemented,
  instagram: notImplemented,
  threads: notImplemented,
  x: notImplemented,
  youtube: notImplemented,
  tiktok: notImplemented,
};

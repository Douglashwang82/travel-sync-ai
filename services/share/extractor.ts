import { generateJson } from "@/lib/gemini";
import type { ItemType } from "@/lib/types";

export interface SharedUrlMetadata {
  name: string;
  item_type: ItemType;
  description: string | null;
  address: string | null;
  rating: number | null;
  price: string | null;
  image_url: string | null;
  booking_url: string;
}

interface GeminiExtraction {
  name: string;
  item_type: ItemType;
  description: string | null;
  address: string | null;
  rating: number | null;
  price: string | null;
  image_url: string | null;
}

const SYSTEM_PROMPT = `You are a travel-data extraction assistant.
Given a URL, an optional page title, description, and body text from a travel-related webpage, extract structured information.

Return a JSON object with exactly these fields:
{
  "name": string,           // Primary name of the hotel, restaurant, flight, activity, etc.
  "item_type": string,      // One of: hotel, restaurant, activity, transport, flight, insurance, other
  "description": string | null,  // 1-2 sentence summary of what this is
  "address": string | null, // Physical address if present
  "rating": number | null,  // Numeric rating on a 0–5 scale; normalize if on a different scale (e.g. 8.5/10 → 4.25)
  "price": string | null,   // Price or price range as a short string, e.g. "$120/night", "$$", "NT$3,500"
  "image_url": string | null // Best image URL found in the page metadata (prefer og:image)
}

Rules:
- If the page is a hotel booking page, item_type = "hotel"
- If it is a restaurant or food review, item_type = "restaurant"
- If it is an airline or flight booking, item_type = "flight"
- For tours, attractions, or sightseeing, item_type = "activity"
- For buses, trains, car rentals, item_type = "transport"
- When uncertain, use "other"
- Extract the most specific, user-facing name (e.g. "Dormy Inn Osaka Shinsaibashi" not "Hotels in Osaka")
- If a field cannot be determined from the content, set it to null`;

/**
 * Fetch a URL and extract travel metadata using Gemini.
 * Throws if the URL cannot be fetched or parsed.
 */
export async function extractUrlMetadata(url: string): Promise<SharedUrlMetadata> {
  const { title, ogTitle, ogDescription, ogImage, bodyText } = await fetchPageContent(url);

  const userMessage = `URL: ${url}
Page title: ${title ?? "N/A"}
og:title: ${ogTitle ?? "N/A"}
og:description: ${ogDescription ?? "N/A"}
og:image: ${ogImage ?? "N/A"}

Body text (first 3000 chars):
${bodyText}`;

  const extracted = await generateJson<GeminiExtraction>(SYSTEM_PROMPT, userMessage);

  return {
    name: extracted.name,
    item_type: extracted.item_type ?? "other",
    description: extracted.description ?? null,
    address: extracted.address ?? null,
    rating: typeof extracted.rating === "number" ? extracted.rating : null,
    price: extracted.price ?? null,
    image_url: extracted.image_url ?? ogImage ?? null,
    booking_url: url,
  };
}

// ─── HTML fetching & scraping ──────────────────────────────────────────────────

interface PageContent {
  title: string | null;
  ogTitle: string | null;
  ogDescription: string | null;
  ogImage: string | null;
  bodyText: string;
}

const FETCH_TIMEOUT_MS = 10_000;
const MAX_BODY_BYTES = 512_000; // 512 KB

async function fetchPageContent(url: string): Promise<PageContent> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let html: string;
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "TravelSyncBot/1.0 (+https://travelsync.ai/bot)",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    clearTimeout(timer);

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} from ${url}`);
    }

    // Read up to MAX_BODY_BYTES to avoid huge payloads
    const buffer = await res.arrayBuffer();
    const slice = buffer.slice(0, MAX_BODY_BYTES);
    html = new TextDecoder("utf-8", { fatal: false }).decode(slice);
  } catch (err) {
    clearTimeout(timer);
    throw new Error(`Failed to fetch URL: ${err instanceof Error ? err.message : String(err)}`);
  }

  return parseHtml(html);
}

function parseHtml(html: string): PageContent {
  const title = extractTag(html, "title");

  const ogTitle = extractMeta(html, "og:title");
  const ogDescription = extractMeta(html, "og:description");
  const ogImage = extractMeta(html, "og:image");

  // Strip scripts, styles, and all tags; collapse whitespace
  const bodyText = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, 3000);

  return { title, ogTitle, ogDescription, ogImage, bodyText };
}

function extractTag(html: string, tag: string): string | null {
  const m = html.match(new RegExp(`<${tag}[^>]*>([^<]*)<\/${tag}>`, "i"));
  return m?.[1]?.trim() ?? null;
}

function extractMeta(html: string, property: string): string | null {
  // Matches both property= and name= variants
  const m = html.match(
    new RegExp(
      `<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']*)["']`,
      "i"
    )
  ) ?? html.match(
    new RegExp(
      `<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${property}["']`,
      "i"
    )
  );
  return m?.[1]?.trim() || null;
}

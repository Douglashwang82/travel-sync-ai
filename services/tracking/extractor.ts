// ─────────────────────────────────────────────────────────────────────────────
// Tracking List — LLM extractor
//
// Turns cleaned page text into structured travel/restaurant items.
// One LLM call per fetched page, schema-constrained via zod.
// ─────────────────────────────────────────────────────────────────────────────

import { z } from "zod";
import { generateJson, GeminiUnavailableError } from "@/lib/gemini";
import type { ExtractedItem, FetchedItem, TrackingList } from "./types";

const ItemSchema = z.object({
  external_id: z.string().min(1).max(200),   // stable id the model picks (slug / url / title)
  title: z.string().min(1).max(200),
  summary: z.string().min(1).max(400),
  url: z.string().url().nullable().optional(),
  category: z.enum(["travel", "restaurant", "attraction", "event", "other"]),
  location: z.string().max(120).nullable().optional(),
  tags: z.array(z.string().max(40)).max(8).default([]),
});

const ResponseSchema = z.object({
  page_changed: z.boolean(),    // true if the page contains trip-relevant content
  items: z.array(ItemSchema).max(20).default([]),
});

type RawExtracted = z.infer<typeof ItemSchema>;

const SYSTEM_PROMPT = `You extract travel/restaurant items from a fetched webpage for a travel-planning assistant.

Return JSON matching this exact shape:
{
  "page_changed": boolean,
  "items": Array<{
    "external_id": string,           // stable slug derived from title+url; 5-60 chars, lowercase, a-z 0-9 -
    "title": string,                 // human-readable, original language if Chinese/Japanese
    "summary": string,               // 1-2 sentences, same language as title
    "url": string | null,            // absolute URL to the specific item, or null if page-level
    "category": "travel" | "restaurant" | "attraction" | "event" | "other",
    "location": string | null,       // city / venue / neighbourhood
    "tags": string[]                 // up to 8 short tags
  }>
}

Rules:
- Extract concrete, user-actionable items only (a restaurant, a hotel deal, an event, a place to visit).
- Skip navigation, footers, ads, generic "about us" blurbs, and login prompts.
- If the page is a single article/post, return ONE item.
- If it's a listing page, return up to 20 of the most recent/prominent items.
- If nothing relevant, return { "page_changed": false, "items": [] }.`;

export async function extractItems(
  list: TrackingList,
  fetched: FetchedItem[]
): Promise<ExtractedItem[]> {
  if (fetched.length === 0) return [];

  const page = fetched[0];
  const userMsg = buildUserMessage(list, page);

  let resp: z.infer<typeof ResponseSchema>;
  try {
    const raw = await generateJson<unknown>(SYSTEM_PROMPT, userMsg);
    resp = ResponseSchema.parse(raw);
  } catch (err) {
    if (err instanceof GeminiUnavailableError) throw err;
    console.error("[tracking/extractor] parse failed", err);
    return [];
  }

  if (!resp.page_changed || resp.items.length === 0) return [];

  return resp.items.map((it: RawExtracted) => ({
    external_id: normaliseId(it.external_id),
    title: it.title,
    summary: it.summary,
    url: it.url ?? page.url,
    image_url: null,
    category: it.category,
    location: it.location ?? list.region ?? null,
    tags: it.tags,
  }));
}

function buildUserMessage(list: TrackingList, page: FetchedItem): string {
  const hints: string[] = [];
  if (list.category) hints.push(`Primary category hint: ${list.category}`);
  if (list.region) hints.push(`Region hint: ${list.region}`);
  if (list.keywords.length) hints.push(`User keywords: ${list.keywords.join(", ")}`);

  return [
    `Source URL: ${page.url ?? list.source_url}`,
    `Page title: ${page.title}`,
    hints.length ? hints.join("\n") : "",
    "",
    "─── Page text ───",
    page.body_text,
  ]
    .filter(Boolean)
    .join("\n");
}

function normaliseId(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\-_/]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120) || "unknown";
}

// Export for tests
export const __test = { ResponseSchema, SYSTEM_PROMPT, normaliseId };

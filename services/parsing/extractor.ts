import { z } from "zod";
import { generateJson } from "@/lib/gemini";
import type { TripContext } from "./context";

// ─── Response schema ──────────────────────────────────────────────────────────

const EntitySchema = z.object({
  type: z.enum([
    "date",
    "date_range",
    "location",
    "flight",
    "hotel",
    "preference",
    "budget",
    "constraint",
    "conflict",
  ]),
  canonicalValue: z.string(),
  displayValue: z.string(),
  confidence: z.number().min(0).max(1),
  attributes: z.record(z.string(), z.unknown()).optional().default({}),
});

const SuggestedActionSchema = z.object({
  action: z.enum([
    "update_trip_core",
    "create_todo_item",
    "flag_conflict",
  ]),
  field: z.string().optional(),
  itemTitle: z.string().optional(),
  itemType: z
    .enum(["hotel", "restaurant", "activity", "transport", "insurance", "flight", "other"])
    .optional(),
});

const ConflictSchema = z.object({
  field: z.string(),
  existingValue: z.string(),
  newValue: z.string(),
  description: z.string(),
});

const ParseResultSchema = z.object({
  relevant: z.boolean(),
  entities: z.array(EntitySchema).default([]),
  suggestedActions: z.array(SuggestedActionSchema).default([]),
  conflicts: z.array(ConflictSchema).default([]),
});

export type ParsedEntity = z.infer<typeof EntitySchema>;
export type SuggestedAction = z.infer<typeof SuggestedActionSchema>;
export type Conflict = z.infer<typeof ConflictSchema>;
export type ParseResult = z.infer<typeof ParseResultSchema>;

// ─── Prompt builder ───────────────────────────────────────────────────────────

function buildSystemPrompt(ctx: TripContext): string {
  const contextLines: string[] = [
    `Current year: ${new Date().getFullYear()}`,
    `Destination: ${ctx.destination ?? "not set"}`,
    `Trip dates: ${ctx.startDate && ctx.endDate ? `${ctx.startDate} to ${ctx.endDate}` : "not set"}`,
  ];

  if (ctx.openItems.length > 0) {
    contextLines.push(`Open to-do items: ${ctx.openItems.join(", ")}`);
  }

  if (ctx.recentEntities.length > 0) {
    const recent = ctx.recentEntities
      .slice(0, 10)
      .map((e) => `${e.type}:${e.canonicalValue}`)
      .join(", ");
    contextLines.push(`Recently extracted facts: ${recent}`);
  }

  return `You are a travel entity extractor for a LINE group trip planning bot.
The primary language is Traditional Chinese (zh-TW). Messages may also contain English or mixed Chinese-English.

Trip context:
${contextLines.map((l) => `- ${l}`).join("\n")}

Your task:
1. Determine if the message contains any travel-relevant information for this trip.
2. If relevant, extract structured entities.
3. Identify any conflicts with existing trip facts.
4. Suggest actions the system should take.

Entity types to extract:
- date: a single date (e.g. 7月15日, July 15)
- date_range: a range of dates (e.g. 7/15-7/20, 7月15日到20日)
- location: destination, city, area, landmark, hotel name, restaurant name
- flight: flight number or carrier mention
- hotel: explicit hotel name or preference
- preference: dietary restrictions, activity preferences, seating preferences
- budget: budget mentions (e.g. 3000以內, under NT$5000)
- constraint: things to avoid or hard constraints (e.g. 不能吃海鮮, avoid Shibuya on Saturday)
- conflict: when new information contradicts known trip facts

Suggested action types:
- update_trip_core: update the trip's destination, start_date, or end_date (field: "destination" | "start_date" | "end_date" | "date_range")
- create_todo_item: a new planning item should be added to the board (provide itemTitle and itemType)
- flag_conflict: there is a contradiction that needs organizer resolution

Rules:
- Set relevant: false for stickers, greetings, reactions, off-topic chat, and messages with no travel signal.
- Prefer no extraction over speculative extraction — only extract when confidence >= 0.6.
- For dates without a year, assume the current or next calendar year based on context.
- canonicalValue for dates must be ISO 8601 (YYYY-MM-DD or YYYY-MM-DD/YYYY-MM-DD for ranges).
- canonicalValue for locations must be the standard English name (e.g. "Osaka" not "大阪").
- Return displayValue as the original text the user typed.

Return ONLY valid JSON matching this schema:
{
  "relevant": boolean,
  "entities": [{ "type", "canonicalValue", "displayValue", "confidence", "attributes"? }],
  "suggestedActions": [{ "action", "field"?, "itemTitle"?, "itemType"? }],
  "conflicts": [{ "field", "existingValue", "newValue", "description" }]
}`;
}

// ─── Extractor ────────────────────────────────────────────────────────────────

const CONFIDENCE_THRESHOLD = 0.6;

export async function extractEntities(
  messageText: string,
  ctx: TripContext
): Promise<ParseResult> {
  const systemPrompt = buildSystemPrompt(ctx);

  let raw: unknown;
  try {
    console.log(`[extractor] calling Gemini for message: "${messageText.substring(0, 30)}..."`);
    raw = await generateJson<unknown>(systemPrompt, messageText);
    console.log(`[extractor] result received, relevant: ${(raw as any)?.relevant}`);
  } catch (err) {
    // LLM failure — treat as irrelevant rather than crashing the pipeline
    console.error("[extractor] Gemini call failed permanently", err);
    return { relevant: false, entities: [], suggestedActions: [], conflicts: [] };
  }

  const result = ParseResultSchema.safeParse(raw);
  if (!result.success) {
    console.warn("[extractor] invalid LLM response shape", result.error.flatten(), raw);
    return { relevant: false, entities: [], suggestedActions: [], conflicts: [] };
  }

  const parsed = result.data;

  // Filter out low-confidence entities
  parsed.entities = parsed.entities.filter(
    (e) => e.confidence >= CONFIDENCE_THRESHOLD
  );

  // If no entities survived the threshold, mark as irrelevant
  if (parsed.entities.length === 0 && parsed.conflicts.length === 0) {
    parsed.relevant = false;
  }

  return parsed;
}

import { z } from "zod";
import { createAdminClient } from "@/lib/db";
import { generateJson, GeminiUnavailableError } from "@/lib/gemini";
import { createItem } from "@/services/trip-state";
import { pushAgentAck } from "@/services/notifications/agent-ack";
import type { AgentDefinition, AgentRunContext, AgentRunResult } from "./types";

const ConfigSchema = z.object({
  destination: z.string().min(2).max(120),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  days: z.number().int().min(1).max(14).default(3),
  vibe: z.enum(["balanced", "foodie", "outdoors", "culture", "relaxed"]).default("balanced"),
});

type DrafterConfig = z.infer<typeof ConfigSchema>;

interface DraftedDay {
  date: string;
  title: string;
  suggestions: Array<{
    /** "activity" | "restaurant" | "hotel" — kept loose because Gemini sometimes invents categories. */
    category: string;
    text: string;
  }>;
}

const DraftSchema = z.object({
  overview: z.string(),
  days: z
    .array(
      z.object({
        date: z.string(),
        title: z.string(),
        suggestions: z.array(
          z.object({
            category: z.string(),
            text: z.string(),
          }),
        ),
      }),
    )
    .max(14),
});

function fallbackDraft(config: DrafterConfig): { overview: string; days: DraftedDay[] } {
  const start = new Date(config.startDate + "T00:00:00Z");
  return {
    overview: `A ${config.days}-day ${config.vibe} outline for ${config.destination}. The AI couldn't reach Gemini, so this is a placeholder — edit before promoting.`,
    days: Array.from({ length: config.days }, (_, i) => {
      const d = new Date(start.getTime() + i * 86_400_000);
      return {
        date: d.toISOString().slice(0, 10),
        title: `Day ${i + 1} in ${config.destination}`,
        suggestions: [
          { category: "activity", text: "Morning: pick a neighborhood walk" },
          { category: "restaurant", text: "Lunch: local specialty" },
          { category: "activity", text: "Afternoon: one museum or park" },
        ],
      };
    }),
  };
}

async function draftWithLLM(config: DrafterConfig): Promise<{ overview: string; days: DraftedDay[] }> {
  try {
    const raw = await generateJson<unknown>(
      [
        `You are drafting a ${config.days}-day trip outline for ${config.destination}, starting ${config.startDate}.`,
        `Vibe: ${config.vibe}.`,
        "Output strict JSON with shape: { overview: string, days: [{ date: 'YYYY-MM-DD', title: string, suggestions: [{ category: 'activity'|'restaurant'|'hotel', text: string }] }] }.",
        "Keep suggestions specific (named neighborhoods or known landmarks). 2-4 suggestions per day.",
        "Never invent flight/hotel bookings. Don't include prices.",
        "Respond with strict JSON only.",
      ].join("\n"),
      JSON.stringify({ destination: config.destination, startDate: config.startDate, days: config.days, vibe: config.vibe }),
    );
    const parsed = DraftSchema.safeParse(raw);
    if (!parsed.success) return fallbackDraft(config);
    return parsed.data;
  } catch (err) {
    if (err instanceof GeminiUnavailableError) return fallbackDraft(config);
    throw err;
  }
}

const AGENT_KEY = "itinerary_drafter";

/**
 * Each suggestion becomes a row in `trip_ideas` tagged with `source_agent`.
 * Ideas already have a "promote → trip_item" flow, which gives the human
 * the final say — exactly the propose-mode contract.
 *
 * We dedupe on (trip_id, text) so re-running doesn't create duplicates;
 * the agent's job is to *refresh* the lane, not pile onto it.
 */
async function persistAsIdeas(
  tripId: string,
  runId: string,
  config: DrafterConfig,
  days: DraftedDay[],
): Promise<{ created: number; skipped: number }> {
  const db = createAdminClient();

  const { data: trip } = await db
    .from("trips")
    .select("group_id")
    .eq("id", tripId)
    .single();
  if (!trip?.group_id) return { created: 0, skipped: 0 };

  const { data: existing } = await db
    .from("trip_ideas")
    .select("text")
    .eq("trip_id", tripId)
    .eq("source_agent", AGENT_KEY);
  const existingTexts = new Set((existing ?? []).map((r) => normalize(r.text as string)));

  type Row = {
    trip_id: string;
    group_id: string;
    submitted_by: string;
    display_name: string;
    category: string;
    text: string;
    source_agent: string;
    source_run_id: string;
    source_inputs: Record<string, unknown>;
  };
  const rows: Row[] = [];
  let skipped = 0;

  for (const day of days) {
    for (const s of day.suggestions) {
      const text = `${day.title}: ${s.text}`;
      if (existingTexts.has(normalize(text))) {
        skipped++;
        continue;
      }
      rows.push({
        trip_id: tripId,
        group_id: trip.group_id as string,
        submitted_by: `agent:${AGENT_KEY}`,
        display_name: "AI itinerary drafter",
        category: ideaCategoryFor(s.category),
        text,
        source_agent: AGENT_KEY,
        source_run_id: runId,
        source_inputs: { date: day.date, vibe: config.vibe, originalCategory: s.category },
      });
    }
  }

  if (rows.length === 0) return { created: 0, skipped };

  const { error } = await db.from("trip_ideas").insert(rows);
  if (error) {
    // Don't fail the agent run for a partial DB error; report counts honestly.
    return { created: 0, skipped: skipped + rows.length };
  }
  return { created: rows.length, skipped };
}

function ideaCategoryFor(raw: string): string {
  const v = raw.toLowerCase();
  if (v.includes("hotel") || v.includes("stay")) return "hotel";
  if (v.includes("food") || v.includes("restaurant") || v.includes("eat")) return "restaurant";
  if (v.includes("activity") || v.includes("see") || v.includes("visit")) return "activity";
  return "general";
}

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * When autonomy is `auto_apply_with_undo` or `auto_apply`, also promote each
 * fresh suggestion to a `trip_items` row tagged with provenance. Dismissing
 * the corresponding ghost card in the AI Updates tile is the undo path —
 * the item soft-disappears from the lane; a future API can hard-delete it.
 */
async function autoApplyToItems(
  tripId: string,
  runId: string,
  config: DrafterConfig,
  days: DraftedDay[],
): Promise<number> {
  let created = 0;
  for (const day of days) {
    for (const s of day.suggestions) {
      const itemType = itemTypeFor(s.category);
      const title = `${day.title}: ${s.text}`;
      const res = await createItem({
        tripId,
        title,
        itemType,
        source: "ai",
        sourceAgent: AGENT_KEY,
        sourceRunId: runId,
        sourceInputs: { date: day.date, vibe: config.vibe, originalCategory: s.category },
      });
      if (res.ok) created++;
    }
  }
  return created;
}

function itemTypeFor(raw: string): "activity" | "hotel" | "restaurant" | "other" {
  const v = raw.toLowerCase();
  if (v.includes("hotel") || v.includes("stay")) return "hotel";
  if (v.includes("restaurant") || v.includes("food") || v.includes("eat")) return "restaurant";
  if (v.includes("activity") || v.includes("see") || v.includes("visit")) return "activity";
  return "other";
}

async function run(ctx: AgentRunContext): Promise<AgentRunResult> {
  const config = ConfigSchema.parse(ctx.config);
  const draft = await draftWithLLM(config);
  const persisted = await persistAsIdeas(ctx.tripId, ctx.customGridId, config, draft.days);

  let itemsCreated = 0;
  if (ctx.autonomy !== "propose_only" && persisted.created > 0) {
    itemsCreated = await autoApplyToItems(ctx.tripId, ctx.customGridId, config, draft.days);
    if (itemsCreated > 0) {
      const msg = `🤖 Itinerary drafter added ${itemsCreated} new ${itemsCreated === 1 ? "activity" : "activities"} to the To-Do board for ${config.destination}. Open the app to review.`;
      await pushAgentAck(ctx.tripId, msg);
    }
  } else if (persisted.created > 0 && ctx.autonomy === "propose_only") {
    // Even in propose_only mode, a one-line nudge to the group is useful so
    // members know to glance at Ideas. Keep this opt-out for the future if it
    // proves noisy.
    const msg = `✦ Itinerary drafter posted ${persisted.created} new suggestion${persisted.created === 1 ? "" : "s"} in Ideas for ${config.destination}.`;
    await pushAgentAck(ctx.tripId, msg);
  }

  return {
    outputKind: "list",
    output: {
      destination: config.destination,
      startDate: config.startDate,
      days: draft.days,
      overview: draft.overview,
      created: persisted.created,
      skipped: persisted.skipped,
      itemsCreated,
      autonomy: ctx.autonomy,
      checkedAt: new Date().toISOString(),
    },
  };
}

export const itineraryDrafter: AgentDefinition<DrafterConfig> = {
  type: AGENT_KEY,
  label: "Itinerary drafter",
  description:
    "Drafts a day-by-day outline for your destination and drops the suggestions into Ideas, ready for you to edit or promote.",
  icon: "🗺️",
  mode: "propose",
  defaultFrequencyHours: 24 * 7, // weekly refresh; users mostly run it on demand
  configSchema: ConfigSchema,
  defaultConfig: {
    destination: "",
    startDate: "",
    days: 3,
    vibe: "balanced",
  } as DrafterConfig,
  configFields: [
    { name: "destination", label: "Destination", type: "text", placeholder: "Kyoto, Japan", required: true },
    { name: "startDate", label: "Start date", type: "date", required: true },
    { name: "days", label: "Number of days", type: "number", placeholder: "3", min: 1, max: 14 },
    {
      name: "vibe",
      label: "Vibe",
      type: "select",
      options: [
        { value: "balanced", label: "Balanced" },
        { value: "foodie", label: "Foodie" },
        { value: "outdoors", label: "Outdoors" },
        { value: "culture", label: "Culture" },
        { value: "relaxed", label: "Relaxed" },
      ],
    },
  ],
  run,
};

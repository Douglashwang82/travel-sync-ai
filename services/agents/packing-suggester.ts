import { z } from "zod";
import { createAdminClient } from "@/lib/db";
import { generateJson, GeminiUnavailableError } from "@/lib/gemini";
import { pushAgentAck } from "@/services/notifications/agent-ack";
import type { AgentDefinition, AgentRunContext, AgentRunResult } from "./types";

const ConfigSchema = z.object({
  tripType: z.enum(["leisure", "business", "adventure", "beach", "city", "ski"]).default("leisure"),
  days: z.number().int().min(1).max(60).default(5),
  /** Hints the LLM about the kind of traveler. */
  notes: z.string().max(200).optional(),
});

type SuggesterConfig = z.infer<typeof ConfigSchema>;

interface Suggestion {
  label: string;
  /** documents | clothing | toiletries | electronics | safety | general */
  category: string;
}

const SuggestionsSchema = z.object({
  summary: z.string(),
  items: z
    .array(
      z.object({
        label: z.string().min(1).max(100),
        category: z.string().min(1).max(40),
      }),
    )
    .max(40),
});

const VALID_CATEGORIES = new Set([
  "documents",
  "clothing",
  "toiletries",
  "electronics",
  "safety",
  "general",
]);

function clampCategory(raw: string): string {
  const v = raw.toLowerCase();
  return VALID_CATEGORIES.has(v) ? v : "general";
}

function fallbackSuggestions(
  config: SuggesterConfig,
  weather: WeatherSnapshot | null,
): { summary: string; items: Suggestion[] } {
  const base: Suggestion[] = [
    { label: "Passport", category: "documents" },
    { label: "Toothbrush + toothpaste", category: "toiletries" },
    { label: "Phone charger", category: "electronics" },
    { label: "Underwear × " + Math.max(3, config.days), category: "clothing" },
    { label: "Pyjamas", category: "clothing" },
  ];
  if (weather?.willRain) base.push({ label: "Compact umbrella", category: "general" });
  if (weather && weather.coldest <= 5) base.push({ label: "Warm jacket", category: "clothing" });
  if (weather && weather.hottest >= 28) base.push({ label: "Sunscreen", category: "toiletries" });

  return {
    summary: `Generic ${config.tripType} packing list (Gemini unavailable).`,
    items: base,
  };
}

interface WeatherSnapshot {
  location: string;
  willRain: boolean;
  rainyDates: string[];
  hottest: number;
  coldest: number;
}

function readWeather(out: Record<string, unknown> | null): WeatherSnapshot | null {
  if (!out) return null;
  const days = (out.days as Array<{ highTempC: number; lowTempC: number }> | undefined) ?? [];
  if (days.length === 0) return null;
  const rainyDates = (out.rainyDates as string[]) ?? [];
  const hottest = Math.max(...days.map((d) => d.highTempC));
  const coldest = Math.min(...days.map((d) => d.lowTempC));
  return {
    location: (out.location as string) ?? "destination",
    willRain: rainyDates.length > 0,
    rainyDates,
    hottest,
    coldest,
  };
}

async function suggestWithLLM(
  config: SuggesterConfig,
  weather: WeatherSnapshot | null,
): Promise<{ summary: string; items: Suggestion[] }> {
  try {
    const raw = await generateJson<unknown>(
      [
        `You are packing for a ${config.days}-day ${config.tripType} trip${weather ? ` in ${weather.location}` : ""}.`,
        weather
          ? `Forecast: highs around ${weather.hottest}°C, lows ${weather.coldest}°C. Rain on ${weather.rainyDates.length} day(s).`
          : "No weather data available.",
        config.notes ? `Traveler notes: ${config.notes}` : "",
        "Produce strict JSON: { summary: string, items: [{ label: string, category: 'documents'|'clothing'|'toiletries'|'electronics'|'safety'|'general' }] }.",
        "Cap items at ~20. Be specific (\"3 t-shirts\" not \"shirts\"). Skip obvious universals like 'wallet'.",
        "Adjust quantities to the trip length. If weather is cold, include layers. If rain, include rain gear.",
      ]
        .filter(Boolean)
        .join("\n"),
      JSON.stringify({ config, weather }),
    );
    const parsed = SuggestionsSchema.safeParse(raw);
    if (!parsed.success) return fallbackSuggestions(config, weather);
    return {
      summary: parsed.data.summary,
      items: parsed.data.items.map((i) => ({ label: i.label, category: clampCategory(i.category) })),
    };
  } catch (err) {
    if (err instanceof GeminiUnavailableError) return fallbackSuggestions(config, weather);
    throw err;
  }
}

const AGENT_KEY = "packing_suggester";

async function autoApplyToPackingItems(
  tripId: string,
  runId: string,
  inputs: Record<string, unknown>,
  items: Suggestion[],
): Promise<number> {
  const db = createAdminClient();

  const { data: trip } = await db
    .from("trips")
    .select("group_id")
    .eq("id", tripId)
    .single();
  if (!trip?.group_id) return 0;

  const { data: existing } = await db
    .from("packing_items")
    .select("label")
    .eq("trip_id", tripId);
  const existingLabels = new Set(
    (existing ?? []).map((r) => (r.label as string).trim().toLowerCase()),
  );

  const rows = items
    .filter((i) => !existingLabels.has(i.label.trim().toLowerCase()))
    .map((i) => ({
      trip_id: tripId,
      group_id: trip.group_id as string,
      label: i.label,
      category: i.category,
      is_shared: true,
      added_by: null,
      source_agent: AGENT_KEY,
      source_run_id: runId,
      source_inputs: inputs,
    }));

  if (rows.length === 0) return 0;

  const { error } = await db.from("packing_items").insert(rows);
  if (error) return 0;
  return rows.length;
}

async function run(ctx: AgentRunContext): Promise<AgentRunResult> {
  const config = ConfigSchema.parse(ctx.config);
  const weatherOutput = await ctx.getOutputOf("weather_forecast");
  const weather = readWeather(weatherOutput);

  const { summary, items } = await suggestWithLLM(config, weather);

  let created = 0;
  if (ctx.autonomy !== "propose_only" && items.length > 0) {
    created = await autoApplyToPackingItems(
      ctx.tripId,
      ctx.customGridId,
      { config, weather },
      items,
    );
    if (created > 0) {
      await pushAgentAck(
        ctx.tripId,
        `🤖 Packing suggester added ${created} item${created === 1 ? "" : "s"} to the shared pack list.`,
      );
    }
  }

  return {
    outputKind: "list",
    output: {
      summary,
      items,
      weatherAware: weather !== null,
      weatherLocation: weather?.location ?? null,
      created,
      autonomy: ctx.autonomy,
      checkedAt: new Date().toISOString(),
    },
  };
}

export const packingSuggester: AgentDefinition<SuggesterConfig> = {
  type: AGENT_KEY,
  label: "Packing suggester",
  description:
    "Builds a packing list tailored to your trip. Reads the Weather forecast tile (if present) to add layers or rain gear.",
  icon: "🧳",
  mode: "propose",
  defaultFrequencyHours: 24 * 7,
  dependsOn: ["weather_forecast"],
  configSchema: ConfigSchema,
  defaultConfig: { tripType: "leisure", days: 5 } as SuggesterConfig,
  configFields: [
    {
      name: "tripType",
      label: "Trip type",
      type: "select",
      options: [
        { value: "leisure", label: "Leisure" },
        { value: "business", label: "Business" },
        { value: "adventure", label: "Adventure" },
        { value: "beach", label: "Beach" },
        { value: "city", label: "City" },
        { value: "ski", label: "Ski / snow" },
      ],
    },
    { name: "days", label: "Number of days", type: "number", placeholder: "5", min: 1, max: 60 },
    { name: "notes", label: "Notes (optional)", type: "text", placeholder: "Two kids, light packers" },
  ],
  run,
};

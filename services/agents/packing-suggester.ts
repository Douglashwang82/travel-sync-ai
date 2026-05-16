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
    { label: "護照", category: "documents" },
    { label: "牙刷與牙膏", category: "toiletries" },
    { label: "手機充電器", category: "electronics" },
    { label: "內衣褲 × " + Math.max(3, config.days), category: "clothing" },
    { label: "睡衣", category: "clothing" },
  ];
  if (weather?.willRain) base.push({ label: "折疊雨傘", category: "general" });
  if (weather && weather.coldest <= 5) base.push({ label: "保暖外套", category: "clothing" });
  if (weather && weather.hottest >= 28) base.push({ label: "防曬乳", category: "toiletries" });

  return {
    summary: `${config.tripType} 行程的通用打包清單(無法連線 Gemini)。`,
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
        `你正在為一趟 ${config.days} 天的「${config.tripType}」旅程打包${weather ? `,目的地是 ${weather.location}` : ""}。`,
        weather
          ? `天氣預報:最高溫約 ${weather.hottest}°C,最低溫 ${weather.coldest}°C,共 ${weather.rainyDates.length} 天可能下雨。`
          : "目前沒有天氣資料。",
        config.notes ? `旅客備註:${config.notes}` : "",
        "請輸出嚴格 JSON:{ summary: string, items: [{ label: string, category: 'documents'|'clothing'|'toiletries'|'electronics'|'safety'|'general' }] }。",
        "所有顯示文字(summary、label)請使用繁體中文。",
        "項目數上限約 20。請寫得具體(例如「T恤 3 件」而非「衣服」),不要列出明顯的萬用物品(如「錢包」)。",
        "請依旅程天數調整數量。天氣冷請加入保暖層,會下雨則加入雨具。",
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
        `🤖 打包小幫手已新增 ${created} 項物品到共享打包清單。`,
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
  label: "打包小幫手",
  description:
    "依旅程量身打造一份打包清單。若有「天氣預報」格子,會自動加入保暖層或雨具。",
  icon: "🧳",
  mode: "propose",
  defaultFrequencyHours: 24 * 7,
  dependsOn: ["weather_forecast"],
  configSchema: ConfigSchema,
  defaultConfig: { tripType: "leisure", days: 5 } as SuggesterConfig,
  configFields: [
    {
      name: "tripType",
      label: "旅程類型",
      type: "select",
      options: [
        { value: "leisure", label: "休閒度假" },
        { value: "business", label: "商務出差" },
        { value: "adventure", label: "冒險探險" },
        { value: "beach", label: "海邊度假" },
        { value: "city", label: "都市旅遊" },
        { value: "ski", label: "滑雪/雪地" },
      ],
    },
    { name: "days", label: "天數", type: "number", placeholder: "5", min: 1, max: 60 },
    { name: "notes", label: "備註(選填)", type: "text", placeholder: "兩位小孩,輕裝出行" },
  ],
  run,
};

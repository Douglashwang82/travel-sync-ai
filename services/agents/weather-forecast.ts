import { z } from "zod";
import { generateText, GeminiUnavailableError } from "@/lib/gemini";
import type { AgentDefinition, AgentRunContext, AgentRunResult } from "./types";

const ConfigSchema = z.object({
  location: z.string().min(2).max(120),                  // city or "City, Country"
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  days: z.number().int().min(1).max(14).default(7),
  units: z.enum(["c", "f"]).default("c"),
});

type WeatherConfig = z.infer<typeof ConfigSchema>;

interface DayForecast {
  date: string;
  /** Short condition phrase: "Sunny", "Light rain", "Thunderstorms". */
  condition: string;
  highTempC: number;
  lowTempC: number;
  /** 0–100 percent. */
  precipChance: number;
}

// ─── Stub fetcher ────────────────────────────────────────────────────────────
// Same pattern as `flight-price-tracker`: deterministic fake data so the agent
// runs without an external API. Wire to a real provider (Open-Meteo,
// AccuWeather, etc.) by replacing this function and reading an env key.
function fetchForecast(config: WeatherConfig): DayForecast[] {
  const seedStr = `${config.location}-${config.startDate}`;
  let seed = 0;
  for (let i = 0; i < seedStr.length; i++) seed = (seed * 31 + seedStr.charCodeAt(i)) >>> 0;
  const rand = (n: number) => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed % n;
  };

  const conditions = [
    "Sunny",
    "Partly cloudy",
    "Cloudy",
    "Light rain",
    "Rain",
    "Thunderstorms",
  ];

  const baseHigh = 18 + rand(15);  // 18–32°C
  const baseLow = baseHigh - 5 - rand(6);

  const start = new Date(config.startDate + "T00:00:00Z");
  return Array.from({ length: config.days }, (_, i) => {
    const date = new Date(start.getTime() + i * 86_400_000).toISOString().slice(0, 10);
    const conditionIdx = rand(conditions.length);
    const precip = conditionIdx <= 1 ? rand(20) : 30 + rand(70);
    return {
      date,
      condition: conditions[conditionIdx]!,
      highTempC: baseHigh + (rand(7) - 3),
      lowTempC: baseLow + (rand(5) - 2),
      precipChance: precip,
    };
  });
}

function isRainy(d: DayForecast): boolean {
  return d.precipChance >= 60 || /rain|thunder/i.test(d.condition);
}

async function summarize(config: WeatherConfig, days: DayForecast[]): Promise<string> {
  const rainy = days.filter(isRainy);
  const totalRainy = rainy.length;
  const fallback =
    totalRainy === 0
      ? `${config.location} 接下來 ${days.length} 天天氣晴朗,預測沒有下雨。`
      : `${config.location} 接下來 ${days.length} 天有 ${totalRainy} 天會下雨,${rainy[0]!.date} 最明顯(${rainy[0]!.condition},降雨機率 ${rainy[0]!.precipChance}%)。`;

  try {
    const text = await generateText(
      "你是一位簡潔的旅行天氣助理。請根據 JSON 格式的天氣預報,用 1-2 句繁體中文簡短指出旅程是晴是雨,以及哪一天特別好或特別糟。不要使用表情符號,也不要寒暄。",
      JSON.stringify({ location: config.location, days }),
    );
    return text.trim() || fallback;
  } catch (err) {
    if (err instanceof GeminiUnavailableError) return fallback;
    throw err;
  }
}

async function run(ctx: AgentRunContext): Promise<AgentRunResult> {
  const config = ConfigSchema.parse(ctx.config);
  const days = fetchForecast(config);
  const summary = await summarize(config, days);
  const rainyDates = days.filter(isRainy).map((d) => d.date);

  return {
    outputKind: "summary",
    output: {
      location: config.location,
      startDate: config.startDate,
      units: config.units,
      days,
      rainyDates,
      summary,
      checkedAt: new Date().toISOString(),
    },
  };
}

export const weatherForecast: AgentDefinition<WeatherConfig> = {
  type: "weather_forecast",
  label: "天氣預報",
  description:
    "監看旅程目的地在出發期間的天氣預報,並標示可能下雨的日子。",
  icon: "⛅",
  mode: "monitor",
  defaultFrequencyHours: 12,
  configSchema: ConfigSchema,
  defaultConfig: {
    location: "",
    startDate: "",
    days: 7,
    units: "c",
  } as WeatherConfig,
  configFields: [
    { name: "location", label: "目的地", type: "text", placeholder: "京都,日本", required: true },
    { name: "startDate", label: "開始日期", type: "date", required: true },
    { name: "days", label: "預報天數", type: "number", placeholder: "7", min: 1, max: 14 },
    {
      name: "units",
      label: "溫度單位",
      type: "select",
      options: [
        { value: "c", label: "攝氏" },
        { value: "f", label: "華氏" },
      ],
    },
  ],
  run,
};

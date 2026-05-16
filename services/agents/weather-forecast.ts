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
      ? `Clear stretch ahead in ${config.location} — no rain forecast in the next ${days.length} days.`
      : `Rain expected on ${totalRainy}/${days.length} days in ${config.location}. Heaviest on ${rainy[0]!.date} (${rainy[0]!.condition}, ${rainy[0]!.precipChance}%).`;

  try {
    const text = await generateText(
      "You are a concise travel weather assistant. Given a JSON forecast, write 1–2 short sentences highlighting whether the trip will be sunny or rainy and which day stands out (best or worst). No emojis. No greetings.",
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
  label: "Weather forecast",
  description:
    "Watches the forecast for your destination across the trip dates and flags rainy days.",
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
    { name: "location", label: "Destination", type: "text", placeholder: "Kyoto, Japan", required: true },
    { name: "startDate", label: "Start date", type: "date", required: true },
    { name: "days", label: "Days to forecast", type: "number", placeholder: "7", min: 1, max: 14 },
    {
      name: "units",
      label: "Units",
      type: "select",
      options: [
        { value: "c", label: "Celsius" },
        { value: "f", label: "Fahrenheit" },
      ],
    },
  ],
  run,
};

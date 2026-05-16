import { z } from "zod";
import { generateText, GeminiUnavailableError } from "@/lib/gemini";
import type { AgentDefinition, AgentRunContext, AgentRunResult } from "./types";

const ConfigSchema = z.object({
  origin: z.string().min(3).max(64),               // e.g. "TPE" or "Taipei"
  destination: z.string().min(3).max(64),          // e.g. "TYO" or "Tokyo"
  departDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  returnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  budget: z.number().int().positive().max(100_000).optional(),
  currency: z.enum(["USD", "TWD", "JPY", "EUR"]).default("USD"),
});

type FlightConfig = z.infer<typeof ConfigSchema>;

interface FlightQuote {
  airline: string;
  price: number;
  durationMinutes: number;
  stops: number;
  bookingUrl: string;
}

// ─── Stub fetcher ────────────────────────────────────────────────────────────
// Real implementation would call an actual flight API. We deterministically
// fake quotes so the framework is exercisable without an API key.
// Replace this function once a `FLIGHT_API_KEY` (Amadeus/Kiwi) is wired up.
async function fetchFlightQuotes(config: FlightConfig): Promise<FlightQuote[]> {
  const seedStr = `${config.origin}-${config.destination}-${config.departDate}`;
  let seed = 0;
  for (let i = 0; i < seedStr.length; i++) seed = (seed * 31 + seedStr.charCodeAt(i)) >>> 0;
  const rand = (n: number) => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed % n;
  };

  const airlines = ["EVA Air", "JAL", "ANA", "China Airlines", "Cathay", "Starlux"];
  const basePrice = 350 + rand(450);
  const dailyDrift = ((Date.now() / 86_400_000) | 0) % 40 - 20;
  return Array.from({ length: 4 }, (_, i) => ({
    airline: airlines[(rand(airlines.length) + i) % airlines.length]!,
    price: basePrice + rand(180) + dailyDrift + i * 25,
    durationMinutes: 180 + rand(240),
    stops: rand(10) < 6 ? 0 : 1,
    bookingUrl: `https://www.google.com/travel/flights?q=${encodeURIComponent(
      `${config.origin} to ${config.destination} ${config.departDate}`
    )}`,
  }));
}

async function summarizeQuotes(config: FlightConfig, quotes: FlightQuote[]): Promise<string> {
  const cheapest = quotes.reduce((a, b) => (a.price < b.price ? a : b));
  const fallback = `今日最低票價:${config.currency} ${cheapest.price} 由 ${cheapest.airline}(${cheapest.stops === 0 ? "直飛" : `轉機 ${cheapest.stops} 次`})提供。`;
  try {
    const text = await generateText(
      "你是一位簡潔的機票特惠助理。請根據 JSON 格式的航班報價列表,用 1-2 句繁體中文短句指出最便宜的選項、是否符合使用者預算(若有提供),以及任何值得注意的取捨(轉機次數、飛行時間)。不要使用表情符號,也不要寒暄。",
      JSON.stringify({ config, quotes }),
    );
    const trimmed = text.trim();
    return trimmed || fallback;
  } catch (err) {
    if (err instanceof GeminiUnavailableError) return fallback;
    throw err;
  }
}

async function run(ctx: AgentRunContext): Promise<AgentRunResult> {
  const config = ConfigSchema.parse(ctx.config);
  const quotes = await fetchFlightQuotes(config);
  const cheapest = quotes.reduce((a, b) => (a.price < b.price ? a : b));
  const summary = await summarizeQuotes(config, quotes);

  return {
    outputKind: "price_tracker",
    output: {
      currency: config.currency,
      cheapestPrice: cheapest.price,
      cheapestAirline: cheapest.airline,
      cheapestStops: cheapest.stops,
      cheapestDurationMinutes: cheapest.durationMinutes,
      bookingUrl: cheapest.bookingUrl,
      budget: config.budget ?? null,
      underBudget: config.budget != null ? cheapest.price <= config.budget : null,
      summary,
      route: `${config.origin} → ${config.destination}`,
      departDate: config.departDate,
      returnDate: config.returnDate ?? null,
      quotes,
      checkedAt: new Date().toISOString(),
    },
  };
}

export const flightPriceTracker: AgentDefinition<FlightConfig> = {
  type: "flight_price_tracker",
  label: "機票價格追蹤",
  description:
    "每天查詢指定航線與日期的機票價格,並標示最便宜的選項(可選擇與預算比對)。",
  icon: "✈️",
  mode: "monitor",
  defaultFrequencyHours: 24,
  configSchema: ConfigSchema,
  defaultConfig: {
    origin: "",
    destination: "",
    departDate: "",
    currency: "USD",
  } as FlightConfig,
  configFields: [
    { name: "origin", label: "出發地(IATA 代碼或城市)", type: "text", placeholder: "TPE", required: true },
    { name: "destination", label: "目的地(IATA 代碼或城市)", type: "text", placeholder: "NRT", required: true },
    { name: "departDate", label: "出發日期", type: "date", required: true },
    { name: "returnDate", label: "回程日期(選填)", type: "date" },
    { name: "budget", label: "預算提醒(選填)", type: "number", placeholder: "500", min: 1 },
    {
      name: "currency",
      label: "幣別",
      type: "select",
      options: [
        { value: "USD", label: "USD" },
        { value: "TWD", label: "TWD" },
        { value: "JPY", label: "JPY" },
        { value: "EUR", label: "EUR" },
      ],
    },
  ],
  run,
};

import { z } from "zod";
import { generateText, GeminiUnavailableError } from "@/lib/gemini";
import type { AgentDefinition, AgentRunContext, AgentRunResult } from "./types";

const ConfigSchema = z.object({
  city: z.string().min(2).max(120),
  checkIn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  checkOut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  guests: z.number().int().min(1).max(10).default(2),
  budgetPerNight: z.number().int().positive().max(100_000).optional(),
  currency: z.enum(["USD", "TWD", "JPY", "EUR"]).default("USD"),
});

type HotelConfig = z.infer<typeof ConfigSchema>;

interface HotelQuote {
  name: string;
  pricePerNight: number;
  rating: number;
  area: string;
  bookingUrl: string;
}

// Stub fetcher — mirrors flight-price-tracker's pattern. Replace once a real
// hotel API is wired (Booking.com partner, Expedia EPS, etc.).
function fetchHotelQuotes(config: HotelConfig): HotelQuote[] {
  const seedStr = `${config.city}-${config.checkIn}-${config.checkOut}`;
  let seed = 0;
  for (let i = 0; i < seedStr.length; i++) seed = (seed * 31 + seedStr.charCodeAt(i)) >>> 0;
  const rand = (n: number) => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed % n;
  };

  const names = ["Park View Inn", "Sakura Hotel", "Grand Tokyo", "Mitsui Garden", "Hyatt Centric", "Citadines Suites"];
  const areas = ["Shibuya", "Shinjuku", "Asakusa", "Ginza", "Roppongi"];
  const basePrice = 90 + rand(220);
  const dailyDrift = ((Date.now() / 86_400_000) | 0) % 30 - 15;

  return Array.from({ length: 5 }, (_, i) => ({
    name: names[(rand(names.length) + i) % names.length]!,
    pricePerNight: basePrice + rand(120) + dailyDrift + i * 18,
    rating: Math.round((3.6 + (rand(15) / 10)) * 10) / 10,
    area: areas[rand(areas.length)]!,
    bookingUrl: `https://www.google.com/travel/hotels?q=${encodeURIComponent(
      `${config.city} hotel ${config.checkIn} to ${config.checkOut}`,
    )}`,
  }));
}

function nightsBetween(checkIn: string, checkOut: string): number {
  const a = new Date(checkIn + "T00:00:00Z").getTime();
  const b = new Date(checkOut + "T00:00:00Z").getTime();
  return Math.max(1, Math.round((b - a) / 86_400_000));
}

async function summarize(
  config: HotelConfig,
  cheapest: HotelQuote,
  totalCheapest: number,
): Promise<string> {
  const budgetTotal = config.budgetPerNight ? config.budgetPerNight * nightsBetween(config.checkIn, config.checkOut) : null;
  const fallback = `最便宜:${cheapest.name}(${cheapest.area},${cheapest.rating}★),每晚 ${config.currency} ${cheapest.pricePerNight},總計 ${config.currency} ${totalCheapest}。`;
  try {
    const text = await generateText(
      "你是一位簡潔的旅遊特惠助理。請根據 JSON 格式的飯店報價,用 1-2 句繁體中文短句點出最便宜的飯店、所在區域、評分,以及若使用者設定預算時是否在預算內。不要使用表情符號,也不要寒暄。",
      JSON.stringify({ config, cheapest, totalCheapest, budgetTotal }),
    );
    return text.trim() || fallback;
  } catch (err) {
    if (err instanceof GeminiUnavailableError) return fallback;
    throw err;
  }
}

async function run(ctx: AgentRunContext): Promise<AgentRunResult> {
  const config = ConfigSchema.parse(ctx.config);
  const quotes = fetchHotelQuotes(config);
  const cheapest = quotes.reduce((a, b) => (a.pricePerNight < b.pricePerNight ? a : b));
  const nights = nightsBetween(config.checkIn, config.checkOut);
  const totalCheapest = cheapest.pricePerNight * nights;
  const summary = await summarize(config, cheapest, totalCheapest);
  const budgetTotal = config.budgetPerNight ? config.budgetPerNight * nights : null;

  return {
    outputKind: "price_tracker",
    output: {
      currency: config.currency,
      cheapestPricePerNight: cheapest.pricePerNight,
      cheapestTotal: totalCheapest,
      cheapestName: cheapest.name,
      cheapestArea: cheapest.area,
      cheapestRating: cheapest.rating,
      bookingUrl: cheapest.bookingUrl,
      city: config.city,
      checkIn: config.checkIn,
      checkOut: config.checkOut,
      nights,
      budgetPerNight: config.budgetPerNight ?? null,
      budgetTotal,
      underBudget: budgetTotal != null ? totalCheapest <= budgetTotal : null,
      summary,
      quotes,
      checkedAt: new Date().toISOString(),
    },
  };
}

export const hotelPriceWatch: AgentDefinition<HotelConfig> = {
  type: "hotel_price_watch",
  label: "飯店價格追蹤",
  description:
    "監看指定城市與入住期間的飯店價格,並標示最便宜的選項(可選擇與每晚預算比對)。",
  icon: "🏨",
  mode: "monitor",
  defaultFrequencyHours: 24,
  configSchema: ConfigSchema,
  defaultConfig: {
    city: "",
    checkIn: "",
    checkOut: "",
    guests: 2,
    currency: "USD",
  } as HotelConfig,
  configFields: [
    { name: "city", label: "城市", type: "text", placeholder: "東京", required: true },
    { name: "checkIn", label: "入住日期", type: "date", required: true },
    { name: "checkOut", label: "退房日期", type: "date", required: true },
    { name: "guests", label: "入住人數", type: "number", placeholder: "2", min: 1, max: 10 },
    { name: "budgetPerNight", label: "每晚預算(選填)", type: "number", placeholder: "200", min: 1 },
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

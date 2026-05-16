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
  const fallback = `Cheapest: ${config.currency} ${cheapest.pricePerNight}/night at ${cheapest.name} (${cheapest.area}, ${cheapest.rating}★). Total ${config.currency} ${totalCheapest}.`;
  try {
    const text = await generateText(
      "You are a concise travel-deals assistant. Given hotel quotes in JSON, write 1-2 short sentences naming the cheapest option, the area, the rating, and whether the total beats the user's budget if one is provided. No emojis. No greetings.",
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
  label: "Hotel price watch",
  description:
    "Watches hotel prices for a city + date range, and flags the cheapest option (optionally vs. a per-night budget).",
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
    { name: "city", label: "City", type: "text", placeholder: "Tokyo", required: true },
    { name: "checkIn", label: "Check-in", type: "date", required: true },
    { name: "checkOut", label: "Check-out", type: "date", required: true },
    { name: "guests", label: "Guests", type: "number", placeholder: "2", min: 1, max: 10 },
    { name: "budgetPerNight", label: "Budget per night (optional)", type: "number", placeholder: "200", min: 1 },
    {
      name: "currency",
      label: "Currency",
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

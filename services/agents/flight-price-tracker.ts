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
  const fallback = `Cheapest today: ${config.currency} ${cheapest.price} on ${cheapest.airline} (${cheapest.stops === 0 ? "direct" : `${cheapest.stops} stop`}).`;
  try {
    const text = await generateText(
      "You are a concise travel-deals assistant. Given a list of flight quotes in JSON, write 1-2 short sentences highlighting the cheapest option, whether it beats the user's budget (if provided), and any notable trade-off (stops, duration). No emojis. No greetings.",
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
  label: "Flight price tracker",
  description:
    "Checks daily flight prices for a route and date, and flags the cheapest option (optionally vs. a budget).",
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
    { name: "origin", label: "Origin (IATA or city)", type: "text", placeholder: "TPE", required: true },
    { name: "destination", label: "Destination (IATA or city)", type: "text", placeholder: "NRT", required: true },
    { name: "departDate", label: "Depart date", type: "date", required: true },
    { name: "returnDate", label: "Return date (optional)", type: "date" },
    { name: "budget", label: "Budget alert (optional)", type: "number", placeholder: "500", min: 1 },
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

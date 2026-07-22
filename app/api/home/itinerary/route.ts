/**
 * POST /api/home/itinerary — public itinerary generator for the index-page
 * survey pipeline (no auth; rate-limited per IP).
 *
 * Streams Server-Sent Events so the landing page can render the agent's
 * reasoning live:
 *   event: step       data: {"id":"analyze|cluster|plan|solve|cost","status":"start|done|fallback","detail":"…"}
 *   event: thought    data: {"text":"…"}
 *   event: itinerary  data: HomeItinerary (lib/home-survey)
 *   event: done       data: {}
 *   event: error      data: {"message":"…"}
 *
 * Pipeline: geographic clustering → LLM day-assignment via lib/llm
 * (validated against the static catalog plus server-resolved trend:<place_id>
 * trending POIs) → the real trip-generation solver → cost roll-up. Every
 * LLM-dependent stage has a deterministic fallback, so an anonymous visitor
 * always receives a complete plan.
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { checkRateLimit } from "@/lib/rate-limit";
import { completeJson } from "@/lib/llm";
import {
  getHomeCountry,
  getHomePoi,
  type HomeCountry,
  type HomePoi,
  type HomeReasoningStepEvent,
} from "@/lib/home-survey";
import { getHomeTrendingPoi, isTrendingPoiId } from "@/services/home-demo/trending-pois";
import {
  MAX_STOPS_PER_DAY,
  buildHomeItinerary,
  clusterPoisIntoDays,
  defaultStartDate,
  defaultSummary,
  defaultTheme,
  defaultTitle,
  haversineKm,
  resolveAssignment,
  scheduleDays,
  weekdayOf,
} from "@/services/home-demo/itinerary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  country: z.enum(["jp", "tw", "us"]),
  poiIds: z.array(z.string().min(1)).min(1).max(14),
  locale: z.enum(["en", "zh-TW"]).default("en"),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  /** Preferred trip length from the dates phase; clamped to what the POI count allows. */
  days: z.number().int().min(1).max(8).optional(),
});

const LLM_TIMEOUT_MS = 18_000;

const PlanSchema = z.object({
  title: z.string().min(1).max(120),
  summary: z.string().min(1).max(500),
  days: z
    .array(
      z.object({
        theme: z.string().min(1).max(80),
        poi_ids: z.array(z.string().min(1)).min(1).max(MAX_STOPS_PER_DAY),
      }),
    )
    .min(1)
    .max(8),
});

function sse(event: string, data: unknown): Uint8Array {
  return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export async function POST(req: NextRequest): Promise<Response> {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "anon";
  const limit = await checkRateLimit("user", `home-itinerary:${ip}`);
  if (!limit.allowed) {
    return Response.json(
      { error: "Too many requests, slow down a little.", code: "RATE_LIMITED" },
      { status: 429, headers: { "retry-after": String(Math.ceil(limit.retryAfterMs / 1000)) } },
    );
  }

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (err) {
    return Response.json(
      { error: "Invalid request body", code: "INVALID_BODY", details: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }

  const country = getHomeCountry(body.country);
  if (!country) {
    return Response.json({ error: "Unknown country", code: "UNKNOWN_COUNTRY" }, { status: 400 });
  }

  const pois: HomePoi[] = [];
  for (const id of new Set(body.poiIds)) {
    // Catalog ids resolve statically; trend:<place_id> ids re-resolve against
    // the trending corpus with a country check — client payloads stay untrusted.
    const poi =
      getHomePoi(id) ?? (isTrendingPoiId(id) ? await getHomeTrendingPoi(id, body.country) : null);
    if (!poi || poi.country !== body.country) {
      return Response.json({ error: `Unknown POI: ${id}`, code: "UNKNOWN_POI" }, { status: 400 });
    }
    pois.push(poi);
  }

  const locale = body.locale;
  const zh = locale === "zh-TW";
  const startDate = body.startDate ?? defaultStartDate();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const step = (id: HomeReasoningStepEvent["id"], status: HomeReasoningStepEvent["status"], detail: string) =>
        controller.enqueue(sse("step", { id, status, detail } satisfies HomeReasoningStepEvent));
      const thought = (text: string) => controller.enqueue(sse("thought", { text }));

      try {
        // 1 — analyze the selection
        step("analyze", "start", zh ? "分析你挑選的地點" : "Analyzing your picks");
        const cities = [...new Set(pois.map((p) => p.city))];
        const meals = pois.filter((p) => p.itemType === "restaurant").length;
        let spreadKm = 0;
        for (const a of pois) for (const b of pois) spreadKm = Math.max(spreadKm, haversineKm(a.lat, a.lng, b.lat, b.lng));
        thought(
          zh
            ? `${pois.length} 個地點，分布在 ${cities.join("、")}，最遠相距 ${Math.round(spreadKm)} 公里，含 ${meals} 個美食點。`
            : `${pois.length} spots across ${cities.join(", ")} — up to ${Math.round(spreadKm)} km apart, including ${meals} food stop${meals === 1 ? "" : "s"}.`,
        );
        step("analyze", "done", zh ? `${pois.length} 個地點 · ${cities.length} 個城市` : `${pois.length} spots · ${cities.length} ${cities.length === 1 ? "city" : "cities"}`);

        // 2 — geographic clustering
        step("cluster", "start", zh ? "依地理位置分配天數" : "Clustering spots into days");
        const clusters = clusterPoisIntoDays(pois, MAX_STOPS_PER_DAY, body.days);
        thought(
          zh
            ? `分成 ${clusters.length} 天，每天最多 ${MAX_STOPS_PER_DAY} 站，相近的地點排在同一天。`
            : `Splitting into ${clusters.length} day${clusters.length === 1 ? "" : "s"} of up to ${MAX_STOPS_PER_DAY} stops, keeping neighbors together.`,
        );
        step("cluster", "done", zh ? `${clusters.length} 天的雛形完成` : `${clusters.length}-day shape drafted`);

        // 3 — LLM day-assignment (optional; clusters are the safety net)
        step("plan", "start", zh ? "AI 重新審視並命名每一天" : "AI refining days and themes");
        let days = clusters;
        let title = defaultTitle(country, clusters.length, locale);
        let summary = defaultSummary(country, pois.length, locale);
        let themes: string[] = [];
        const llm = await llmPlan(country, pois, clusters.length, locale);
        if (llm) {
          const resolved = resolveAssignment(llm.days.map((d) => d.poi_ids), pois);
          if (resolved) {
            days = resolved;
            themes = llm.days.map((d) => d.theme);
          }
          title = llm.title;
          summary = llm.summary;
          thought(zh ? `行程定名：「${llm.title}」` : `Naming the trip: “${llm.title}”`);
          step("plan", "done", zh ? "AI 規劃完成" : "AI plan locked in");
        } else {
          thought(
            zh
              ? "AI 暫時沒有回應，改用地理分群的結果繼續。"
              : "The model didn't answer in time — continuing with the geographic draft.",
          );
          step("plan", "fallback", zh ? "使用地理分群結果" : "Using geographic draft");
        }

        // 4 — solve timing with the production solver
        step("solve", "start", zh ? "模擬每日動線與時間" : "Simulating routes and timing");
        const { days: scheduled, usedSolver } = scheduleDays(days, weekdayOf(startDate));
        for (let i = 0; i < scheduled.length; i++) {
          const d = scheduled[i];
          if (d.stops.length === 0) continue;
          thought(
            zh
              ? `第 ${i + 1} 天：${d.stops.length} 站，步行與交通約 ${Math.max(1, Math.round(d.travelKm))} 公里。`
              : `Day ${i + 1}: ${d.stops.length} stops, ~${Math.max(1, Math.round(d.travelKm))} km between them.`,
          );
        }
        step(
          "solve",
          usedSolver ? "done" : "fallback",
          usedSolver
            ? zh ? "動線通過時間窗檢查" : "Routes pass time-window checks"
            : zh ? "改用就近排序動線" : "Using nearest-neighbor routing",
        );

        // 5 — costs
        step("cost", "start", zh ? "估算每日花費" : "Estimating costs");
        const itinerary = buildHomeItinerary({
          country,
          scheduled,
          startDate,
          title,
          summary,
          themes: themes.length > 0 ? themes : scheduled.map((d) => defaultTheme(d, locale)),
          locale,
        });
        step("cost", "done", zh ? `總計約 ${itinerary.totalCostLocal}` : `≈ ${itinerary.totalCostLocal} total`);

        controller.enqueue(sse("itinerary", itinerary));
        controller.enqueue(sse("done", {}));
      } catch (err) {
        controller.enqueue(sse("error", { message: err instanceof Error ? err.message : String(err) }));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}

async function llmPlan(
  country: HomeCountry,
  pois: HomePoi[],
  dayCount: number,
  locale: "en" | "zh-TW",
): Promise<z.infer<typeof PlanSchema> | null> {
  const list = pois
    .map((p) => `- id=${p.id} | ${p.name} | ${p.city} | ${p.itemType} | lat=${p.lat} lng=${p.lng}`)
    .join("\n");
  const language = locale === "zh-TW" ? "Traditional Chinese (繁體中文)" : "English";
  const prompt = [
    `A traveler picked these places in ${country.name}:`,
    list,
    "",
    `Group them into exactly ${dayCount} day(s), max ${MAX_STOPS_PER_DAY} places per day.`,
    "Rules:",
    "- Use every id exactly once; never invent ids.",
    "- Keep each day geographically tight (same city/area).",
    "- Order ids within a day as a sensible visiting sequence; restaurants near lunch or dinner.",
    `- Write title (catchy, ≤60 chars), summary (1–2 sentences) and a short theme per day in ${language}.`,
    "",
    `Return JSON: {"title": string, "summary": string, "days": [{"theme": string, "poi_ids": string[]}]}`,
  ].join("\n");

  try {
    return await Promise.race([
      completeJson(prompt, {
        taskClass: "trip_generation",
        schema: PlanSchema,
        systemPrompt:
          "You are a meticulous travel itinerary planner. Respond with valid JSON only that exactly matches the requested shape.",
        metadata: { surface: "home_demo" },
      }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), LLM_TIMEOUT_MS)),
    ]);
  } catch (err) {
    console.warn(`[home-itinerary] LLM plan failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

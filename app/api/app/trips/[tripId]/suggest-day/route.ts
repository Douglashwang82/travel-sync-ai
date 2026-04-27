import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/db";
import { requireAppTripAccess } from "@/lib/app-server";
import { generateJson, GeminiUnavailableError } from "@/lib/gemini";

type RouteContext = { params: Promise<{ tripId: string }> };

export interface DaySuggestion {
  title: string;
  item_type: "hotel" | "restaurant" | "activity" | "transport" | "flight" | "other";
  description: string;
  reason: string;
}

export interface SuggestDayResponse {
  date: string;
  day_number: number;
  suggestions: DaySuggestion[];
}

const SYSTEM_PROMPT = `You are a travel planning assistant. Suggest 4 varied activities or plans for a specific day of a trip. Return ONLY valid JSON with this exact shape:
{
  "suggestions": [
    {
      "title": "string (concise name, max 60 chars)",
      "item_type": "hotel" | "restaurant" | "activity" | "transport" | "flight" | "other",
      "description": "string (1-2 sentences, max 120 chars)",
      "reason": "string (why this suits the group, max 80 chars)"
    }
  ]
}
Mix item types: aim for at least one meal and one activity. Be specific to the destination and day number. Avoid anything already in the existing itinerary.`;

export async function GET(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const { tripId } = await ctx.params;
  const auth = await requireAppTripAccess(req, tripId);
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const date = url.searchParams.get("date");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json(
      { error: "Missing or invalid date parameter (expected YYYY-MM-DD)", code: "INVALID_DATE" },
      { status: 400 }
    );
  }

  const db = createAdminClient();

  const { data: trip } = await db
    .from("trips")
    .select("id, destination_name, start_date, end_date, group_id")
    .eq("id", tripId)
    .single();

  if (!trip) {
    return NextResponse.json({ error: "Trip not found", code: "NOT_FOUND" }, { status: 404 });
  }

  let dayNumber = 1;
  if (trip.start_date) {
    const start = new Date((trip.start_date as string) + "T00:00:00Z");
    const target = new Date(date + "T00:00:00Z");
    dayNumber = Math.max(1, Math.round((target.getTime() - start.getTime()) / 86_400_000) + 1);
  }

  const [memoriesResult, prefsResult, existingResult] = await Promise.all([
    db
      .from("trip_memories")
      .select("item_type, title, summary, address, rating")
      .eq("trip_id", tripId)
      .order("mention_count", { ascending: false })
      .limit(12),
    db
      .from("parsed_entities")
      .select("display_value")
      .eq("group_id", trip.group_id as string)
      .eq("entity_type", "preference")
      .order("created_at", { ascending: false })
      .limit(15),
    db
      .from("trip_items")
      .select("title, item_type")
      .eq("trip_id", tripId),
  ]);

  const destination = (trip.destination_name as string | null) ?? "the destination";

  const memorySummary = memoriesResult.data?.length
    ? memoriesResult.data
        .map((m) => {
          const parts = [`${m.item_type}: ${m.title}`];
          if (m.address) parts.push(`(${m.address})`);
          if (m.rating) parts.push(`★${m.rating}`);
          return `- ${parts.join(" ")}`;
        })
        .join("\n")
    : "None recorded";

  const prefSummary = prefsResult.data?.length
    ? prefsResult.data.map((p) => `- ${p.display_value}`).join("\n")
    : "None recorded";

  const existingSummary = existingResult.data?.length
    ? existingResult.data.map((i) => `- ${i.title}`).join("\n")
    : "None yet";

  const userMessage = `
Destination: ${destination}
Target date: ${date} (Day ${dayNumber} of the trip)

Group preferences:
${prefSummary}

Group interests and memories:
${memorySummary}

Already in the itinerary (do not repeat these):
${existingSummary}

Suggest 4 things for Day ${dayNumber} in ${destination}.
`.trim();

  try {
    const result = await generateJson<{ suggestions: DaySuggestion[] }>(SYSTEM_PROMPT, userMessage);
    const suggestions = Array.isArray(result.suggestions)
      ? result.suggestions.slice(0, 4)
      : [];

    return NextResponse.json<SuggestDayResponse>({ date, day_number: dayNumber, suggestions });
  } catch (err) {
    if (err instanceof GeminiUnavailableError) {
      return NextResponse.json(
        { error: err.message, code: "AI_UNAVAILABLE" },
        { status: 503 }
      );
    }
    console.error("[suggest-day] Gemini error:", err);
    return NextResponse.json(
      { error: "Failed to generate suggestions", code: "AI_ERROR" },
      { status: 500 }
    );
  }
}

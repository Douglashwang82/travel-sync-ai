import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/db";
import { requireAppTripWithGroup } from "@/lib/app-server";
import { generateJson, GeminiUnavailableError } from "@/lib/gemini";
import type { Trip, ItemStage, ItemType } from "@/lib/types";

type RouteContext = { params: Promise<{ tripId: string }> };

export interface PlanMasterSuggestion {
  text: string;
  why?: string;
}

export interface PlanMasterReview {
  summary: string;
  readiness: number;
  mustHave: PlanMasterSuggestion[];
  whatNext: PlanMasterSuggestion[];
  watchOut: PlanMasterSuggestion[];
  onTrack: PlanMasterSuggestion[];
  generatedAt: string;
}

const SYSTEM_PROMPT = `You are a meticulous trip-planning reviewer. Read the trip context the user provides and produce a concise review that helps the group spot gaps and next actions.

Always respond in JSON matching this schema:
{
  "summary": string,           // 1-2 sentence overview of where the trip stands
  "readiness": number,         // integer 0-100, how ready the trip is to go
  "mustHave": [ { "text": string, "why": string } ],   // essential things still missing (hotels, flights, visa, insurance, key bookings)
  "whatNext": [ { "text": string, "why": string } ],   // the next 3-5 concrete actions the group should take
  "watchOut": [ { "text": string, "why": string } ],   // risks, conflicts, blocked decisions, tight timelines
  "onTrack": [ { "text": string, "why": string } ]     // things already settled worth acknowledging
}

Guidelines:
- Keep each "text" under 80 characters and each "why" under 120 characters.
- Match the user's language. If the trip content is in Chinese, respond in Traditional Chinese; otherwise respond in English.
- Aim for 2-4 items per bucket. Empty arrays are fine when a bucket truly has nothing to say.
- Be specific: reference the destination, dates, or item titles where useful — don't write generic advice.
- "mustHave" is only for missing essentials, never for things already confirmed.
- Never invent items that aren't in the trip data.`;

interface ItemSummary {
  title: string;
  type: ItemType;
  stage: ItemStage;
  hasBooking: boolean;
  optionCount: number;
  voteCount: number;
}

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const start = new Date(iso + "T00:00:00Z").getTime();
  const today = Date.now();
  return Math.round((start - today) / (1000 * 60 * 60 * 24));
}

function tripDuration(trip: Pick<Trip, "start_date" | "end_date">): number | null {
  if (!trip.start_date || !trip.end_date) return null;
  const start = new Date(trip.start_date + "T00:00:00Z").getTime();
  const end = new Date(trip.end_date + "T00:00:00Z").getTime();
  return Math.round((end - start) / (1000 * 60 * 60 * 24)) + 1;
}

function buildContext(
  trip: Trip,
  items: ItemSummary[],
  ideas: Array<{ category: string; text: string }>,
  memberCount: number,
): string {
  const lines: string[] = [];
  lines.push(`Destination: ${trip.destination_name ?? "(undecided)"}`);
  lines.push(`Departure: ${trip.departure_name ?? "(unspecified)"}`);
  lines.push(`Dates: ${trip.start_date ?? "TBD"} → ${trip.end_date ?? "TBD"}`);
  const duration = tripDuration(trip);
  if (duration != null) lines.push(`Duration: ${duration} days`);
  const dUntil = daysUntil(trip.start_date);
  if (dUntil != null) {
    lines.push(
      dUntil >= 0 ? `Days until departure: ${dUntil}` : `Trip already started/passed (${Math.abs(dUntil)} days ago)`,
    );
  }
  lines.push(`Status: ${trip.status}`);
  lines.push(`Group members: ${memberCount}`);

  lines.push("");
  lines.push(`Items (${items.length}):`);
  if (items.length === 0) {
    lines.push("  (none yet)");
  } else {
    for (const it of items) {
      const flags = [
        it.stage,
        it.hasBooking ? "booked" : null,
        it.optionCount > 0 ? `${it.optionCount} options` : null,
        it.voteCount > 0 ? `${it.voteCount} votes` : null,
      ]
        .filter(Boolean)
        .join(", ");
      lines.push(`  - [${it.type}] ${it.title} (${flags})`);
    }
  }

  lines.push("");
  lines.push(`Brainstorm ideas (${ideas.length}):`);
  if (ideas.length === 0) {
    lines.push("  (none yet)");
  } else {
    for (const idea of ideas.slice(0, 30)) {
      lines.push(`  - [${idea.category}] ${idea.text}`);
    }
    if (ideas.length > 30) lines.push(`  …and ${ideas.length - 30} more`);
  }

  return lines.join("\n");
}

/**
 * POST /api/app/trips/:tripId/plan-master
 * Reviews the entire trip (items, ideas, votes, dates) with Gemini and returns
 * a structured "trip plan master" review: must-haves, next steps, risks, on-track.
 */
export async function POST(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const { tripId } = await ctx.params;
  const auth = await requireAppTripWithGroup(req, tripId);
  if (!auth.ok) return auth.response;

  const db = createAdminClient();

  const [tripRes, itemsRes, ideasRes, membersRes] = await Promise.all([
    db.from("trips").select("*").eq("id", tripId).single(),
    db
      .from("trip_items")
      .select("id, title, item_type, stage, booking_status, confirmed_option_id")
      .eq("trip_id", tripId),
    db
      .from("trip_ideas")
      .select("category, text")
      .eq("trip_id", tripId)
      .order("created_at", { ascending: false })
      .limit(50),
    db
      .from("group_members")
      .select("line_user_id", { count: "exact", head: true })
      .eq("group_id", auth.groupId)
      .is("left_at", null),
  ]);

  if (tripRes.error || !tripRes.data) {
    return NextResponse.json(
      { error: "Trip not found", code: "NOT_FOUND" },
      { status: 404 },
    );
  }
  const trip = tripRes.data as Trip;
  const rawItems = (itemsRes.data ?? []) as Array<{
    id: string;
    title: string;
    item_type: ItemType;
    stage: ItemStage;
    booking_status: string;
    confirmed_option_id: string | null;
  }>;

  const itemIds = rawItems.map((i) => i.id);
  const optionCountByItem = new Map<string, number>();
  const voteCountByItem = new Map<string, number>();
  if (itemIds.length > 0) {
    const [optsRes, votesRes] = await Promise.all([
      db.from("trip_item_options").select("trip_item_id").in("trip_item_id", itemIds),
      db.from("votes").select("trip_item_id").in("trip_item_id", itemIds),
    ]);
    for (const row of (optsRes.data ?? []) as Array<{ trip_item_id: string }>) {
      optionCountByItem.set(row.trip_item_id, (optionCountByItem.get(row.trip_item_id) ?? 0) + 1);
    }
    for (const row of (votesRes.data ?? []) as Array<{ trip_item_id: string }>) {
      voteCountByItem.set(row.trip_item_id, (voteCountByItem.get(row.trip_item_id) ?? 0) + 1);
    }
  }

  const items: ItemSummary[] = rawItems.map((i) => ({
    title: i.title,
    type: i.item_type,
    stage: i.stage,
    hasBooking: i.booking_status === "booked",
    optionCount: optionCountByItem.get(i.id) ?? 0,
    voteCount: voteCountByItem.get(i.id) ?? 0,
  }));

  const ideas = (ideasRes.data ?? []) as Array<{ category: string; text: string }>;
  const memberCount = membersRes.count ?? 0;

  const context = buildContext(trip, items, ideas, memberCount);

  let review: PlanMasterReview;
  try {
    const parsed = await generateJson<Omit<PlanMasterReview, "generatedAt">>(
      SYSTEM_PROMPT,
      `Trip context:\n${context}\n\nReview this trip plan.`,
    );
    review = {
      summary: typeof parsed.summary === "string" ? parsed.summary : "",
      readiness:
        typeof parsed.readiness === "number"
          ? Math.max(0, Math.min(100, Math.round(parsed.readiness)))
          : 0,
      mustHave: Array.isArray(parsed.mustHave) ? parsed.mustHave.slice(0, 6) : [],
      whatNext: Array.isArray(parsed.whatNext) ? parsed.whatNext.slice(0, 6) : [],
      watchOut: Array.isArray(parsed.watchOut) ? parsed.watchOut.slice(0, 6) : [],
      onTrack: Array.isArray(parsed.onTrack) ? parsed.onTrack.slice(0, 6) : [],
      generatedAt: new Date().toISOString(),
    };
  } catch (err) {
    if (err instanceof GeminiUnavailableError) {
      return NextResponse.json(
        { error: "AI is temporarily unavailable. Please retry shortly.", code: "AI_UNAVAILABLE" },
        { status: 503 },
      );
    }
    console.error("[plan-master] generateJson failed:", err);
    return NextResponse.json(
      { error: "Failed to generate review", code: "AI_ERROR" },
      { status: 500 },
    );
  }

  return NextResponse.json<{ review: PlanMasterReview }>({ review });
}

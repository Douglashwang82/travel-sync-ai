import { createAdminClient } from "@/lib/db";
import type { ItemType, Trip, TripItem, TripItemOption } from "@/lib/types";
import { getReadinessSnapshot, type ReadinessSnapshot } from "@/services/readiness";

export type TripPhase =
  | "planning"
  | "countdown"
  | "departure"
  | "active"
  | "return"
  | "complete";

export interface OperationsSummary {
  tripId: string;
  destinationName: string;
  destinationAnchor: {
    placeId: string | null;
    formattedAddress: string | null;
    googleMapsUrl: string | null;
    lat: number | null;
    lng: number | null;
    timeZone: string | null;
  };
  phase: TripPhase;
  headline: string;
  nextActions: string[];
  activeRisks: string[];
  transportStatus: string[];
  confirmedToday: string[];
  readiness: {
    completionPercent: number;
    confidenceScore: number;
    blockerCount: number;
  };
  confirmedLinks: Array<{
    itemId: string;
    title: string;
    itemType: ItemType;
    googleMapsUrl: string | null;
    bookingUrl: string | null;
  }>;
  sourceOfTruth: string[];
  freshness: {
    generatedAt: string;
    degraded: boolean;
    notes: string[];
  };
}

export async function getOperationsSummary(
  tripId: string
): Promise<OperationsSummary | null> {
  const db = createAdminClient();

  const { data: trip } = await db
    .from("trips")
    .select(`
      id,
      destination_name,
      destination_place_id,
      destination_formatted_address,
      destination_google_maps_url,
      destination_lat,
      destination_lng,
      destination_timezone,
      start_date,
      end_date,
      status
    `)
    .eq("id", tripId)
    .single();

  if (!trip) return null;

  const { data: items } = await db
    .from("trip_items")
    .select(`
      id,
      title,
      item_type,
      stage,
      deadline_at,
      confirmed_option_id,
      trip_item_options!trip_items_confirmed_option_id_fkey (
        id,
        google_maps_url,
        booking_url
      )
    `)
    .eq("trip_id", tripId)
    .order("created_at", { ascending: true });

  const readiness = await getReadinessSnapshot(tripId);
  return buildOperationsSummary(
    trip as Pick<
      Trip,
      | "id"
      | "destination_name"
      | "destination_place_id"
      | "destination_formatted_address"
      | "destination_google_maps_url"
      | "destination_lat"
      | "destination_lng"
      | "destination_timezone"
      | "start_date"
      | "end_date"
      | "status"
    >,
    ((items ?? []) as Pick<
      TripItem,
      "id" | "title" | "item_type" | "stage" | "deadline_at" | "confirmed_option_id"
    >[]).map((item) => ({
      ...item,
      confirmed_option: extractConfirmedOption(item),
    })) as Array<
      Pick<
        TripItem,
        "id" | "title" | "item_type" | "stage" | "deadline_at" | "confirmed_option_id"
      > & {
        confirmed_option: Pick<TripItemOption, "google_maps_url" | "booking_url"> | null;
      }
    >,
    readiness
  );
}

export function buildOperationsSummary(
  trip: Pick<
    Trip,
    | "id"
    | "destination_name"
    | "destination_place_id"
    | "destination_formatted_address"
    | "destination_google_maps_url"
    | "destination_lat"
    | "destination_lng"
    | "destination_timezone"
    | "start_date"
    | "end_date"
    | "status"
  >,
  items: Array<
    Pick<
      TripItem,
      "id" | "title" | "item_type" | "stage" | "deadline_at" | "confirmed_option_id"
    > & {
      confirmed_option: Pick<TripItemOption, "google_maps_url" | "booking_url"> | null;
    }
  >,
  readiness: ReadinessSnapshot | null
): OperationsSummary {
  const phase = deriveTripPhase(trip);
  const confirmedItems = items.filter((item) => item.stage === "confirmed");
  const transportItems = confirmedItems.filter(
    (item) => item.item_type === "flight" || item.item_type === "transport"
  );

  const readinessBlockers = readiness?.blockers ?? [];
  const nextActions = [
    ...(readiness?.missingInputs ?? []).slice(0, 3),
    ...deriveNextActionsFromPhase(phase, trip, transportItems),
  ].slice(0, 4);

  const activeRisks = [
    ...readinessBlockers.slice(0, 3).map((item) => item.title),
    ...deriveActiveRisks(phase, readiness, transportItems),
  ].slice(0, 4);

  return {
    tripId: trip.id,
    destinationName: trip.destination_name,
    destinationAnchor: {
      placeId: trip.destination_place_id,
      formattedAddress: trip.destination_formatted_address,
      googleMapsUrl: trip.destination_google_maps_url,
      lat: trip.destination_lat,
      lng: trip.destination_lng,
      timeZone: trip.destination_timezone,
    },
    phase,
    headline: buildHeadline(phase, trip.destination_name, nextActions.length, activeRisks.length),
    nextActions,
    activeRisks,
    transportStatus:
      transportItems.length > 0
        ? transportItems.map(
            (item) => `${formatItemType(item.item_type)} committed: ${item.title}`
          )
        : ["No committed transport is available for live operations yet."],
    confirmedToday: confirmedItems.slice(0, 4).map((item) => item.title),
    readiness: {
      completionPercent: readiness?.completionPercent ?? 0,
      confidenceScore: readiness?.confidenceScore ?? 0,
      blockerCount: readinessBlockers.length,
    },
    confirmedLinks: confirmedItems
      .map((item) => ({
        itemId: item.id,
        title: item.title,
        itemType: item.item_type,
        googleMapsUrl: item.confirmed_option?.google_maps_url ?? null,
        bookingUrl: item.confirmed_option?.booking_url ?? null,
      }))
      .filter((item) => item.googleMapsUrl || item.bookingUrl)
      .slice(0, 6),
    sourceOfTruth: readiness?.committedSourceSummary ?? [],
    freshness: {
      generatedAt: new Date().toISOString(),
      degraded: readiness == null || transportItems.length === 0,
      notes: buildFreshnessNotes(readiness, transportItems),
    },
  };
}

function deriveTripPhase(
  trip: Pick<Trip, "start_date" | "end_date" | "status" | "destination_timezone">
): TripPhase {
  if (trip.status === "completed") return "complete";

  const today = todayIso(trip.destination_timezone);
  const start = trip.start_date;
  const end = trip.end_date;

  if (!start || !end) return "planning";
  if (today < start) return daysBetween(today, start) <= 7 ? "countdown" : "planning";
  if (today === start) return "departure";
  if (today > start && today < end) return "active";
  if (today >= end) return "return";
  return "planning";
}

function deriveNextActionsFromPhase(
  phase: TripPhase,
  trip: Pick<Trip, "start_date" | "end_date">,
  transportItems: Array<Pick<TripItem, "title">>
): string[] {
  switch (phase) {
    case "planning":
      return ["Lock trip dates and at least one transport or stay item before using operations heavily."];
    case "countdown":
      return [
        "Use /ready to verify remaining blockers before departure week.",
        transportItems.length > 0
          ? "Double-check departure timing against official provider channels."
          : "Commit the main transport so departure readiness can be validated.",
      ];
    case "departure":
      return [
        "Send one final group status pulse instead of multiple individual nudges.",
        trip.start_date
          ? `Today is the departure date: ${trip.start_date}. Reconfirm airport or meetup timing.`
          : "Reconfirm departure timing.",
      ];
    case "active":
      return ["Use /brief for a daily run-of-day summary.", "Keep all group updates batched into one operational message."];
    case "return":
      return [
        trip.end_date
          ? `Return date: ${trip.end_date}. Reconfirm checkout and transport.`
          : "Reconfirm return timing.",
        "Use /complete to wrap up the trip, or /exp-summary to settle expenses.",
      ];
    case "complete":
      return ["Trip is complete. Use /exp-summary to settle expenses or /start to plan the next trip."];
  }
}

function deriveActiveRisks(
  phase: TripPhase,
  readiness: ReadinessSnapshot | null,
  transportItems: Array<Pick<TripItem, "title">>
): string[] {
  const risks: string[] = [];

  if (!readiness || readiness.confidenceScore < 50) {
    risks.push("Operations data is partial. Confirm more committed details before relying on this view.");
  }
  if (transportItems.length === 0 && (phase === "countdown" || phase === "departure" || phase === "return")) {
    risks.push("No committed transport is available for operational tracking.");
  }

  return risks;
}

function buildHeadline(
  phase: TripPhase,
  destinationName: string,
  nextActionCount: number,
  riskCount: number
): string {
  const phaseLabel = phase.charAt(0).toUpperCase() + phase.slice(1);
  return `${phaseLabel} mode for ${destinationName}: ${nextActionCount} next action${nextActionCount === 1 ? "" : "s"}, ${riskCount} active risk${riskCount === 1 ? "" : "s"}.`;
}

function buildFreshnessNotes(
  readiness: ReadinessSnapshot | null,
  transportItems: Array<Pick<TripItem, "title">>
): string[] {
  const notes: string[] = [
    "This view uses committed trip data only, not unconfirmed planning chatter.",
  ];

  if (!readiness) {
    notes.push("Readiness data is unavailable.");
  } else if (readiness.confidenceScore < 50) {
    notes.push(
      `Readiness confidence is ${readiness.confidenceScore}%, so missing details are shown explicitly as unknown.`
    );
  }

  if (transportItems.length === 0) {
    notes.push("Live transport monitoring is not active because no committed transport has been captured yet.");
  } else {
    notes.push("Transport shown here is committed itinerary data, not live monitored status yet.");
  }

  return notes;
}

function formatItemType(itemType: ItemType): string {
  if (itemType === "flight") return "Flight";
  if (itemType === "transport") return "Transport";
  return itemType;
}

function todayIso(timeZone?: string | null): string {
  if (timeZone) {
    try {
      return new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());
    } catch {
      // Fall through to UTC if the stored timezone is invalid.
    }
  }
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  return Math.round((to - from) / (1000 * 60 * 60 * 24));
}

function extractConfirmedOption(
  item: Record<string, unknown>
): Pick<TripItemOption, "google_maps_url" | "booking_url"> | null {
  const option = item.trip_item_options;
  const resolved = Array.isArray(option) ? option[0] : option;
  if (!resolved || typeof resolved !== "object") return null;

  const candidate = resolved as Record<string, unknown>;
  return {
    google_maps_url:
      typeof candidate.google_maps_url === "string" ? candidate.google_maps_url : null,
    booking_url: typeof candidate.booking_url === "string" ? candidate.booking_url : null,
  };
}

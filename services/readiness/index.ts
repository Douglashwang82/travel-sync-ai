import { createAdminClient } from "@/lib/db";
import type { BookingStatus, ItemType, Trip, TripItem } from "@/lib/types";

export type ReadinessCategory =
  | "documents"
  | "reservations"
  | "transport"
  | "money"
  | "packing"
  | "meetup"
  | "return";

export type ReadinessStatus = "open" | "completed" | "dismissed" | "unknown";

export interface ReadinessItem {
  id: string;
  tripId: string;
  category: ReadinessCategory;
  title: string;
  description: string | null;
  severity: "low" | "medium" | "high" | "critical";
  status: ReadinessStatus;
  dueAt: string | null;
  sourceKind: "system" | "manual" | "incident";
  evidence: string[];
}

export interface ReadinessSnapshot {
  tripId: string;
  trip: {
    destinationName: string;
    startDate: string | null;
    endDate: string | null;
  };
  confidenceScore: number;
  completionPercent: number;
  blockers: ReadinessItem[];
  items: ReadinessItem[];
  missingInputs: string[];
  committedSourceSummary: string[];
}

export async function getReadinessSnapshot(tripId: string): Promise<ReadinessSnapshot | null> {
  const db = createAdminClient();

  const { data: trip } = await db
    .from("trips")
    .select("id, destination_name, start_date, end_date")
    .eq("id", tripId)
    .single();

  if (!trip) return null;

  const { data: items } = await db
    .from("trip_items")
    .select("id, title, item_type, stage, confirmed_option_id, booking_status")
    .eq("trip_id", tripId);

  const confirmedItems = ((items ?? []) as Pick<
    TripItem,
    "id" | "title" | "item_type" | "stage" | "confirmed_option_id" | "booking_status"
  >[]).filter((item) => item.stage === "confirmed");

  return buildReadinessSnapshot(
    trip as Pick<Trip, "id" | "destination_name" | "start_date" | "end_date">,
    confirmedItems
  );
}

export function buildReadinessSnapshot(
  trip: Pick<Trip, "id" | "destination_name" | "start_date" | "end_date">,
  confirmedItems: Array<
    Pick<TripItem, "id" | "title" | "item_type" | "confirmed_option_id" | "booking_status">
  >
): ReadinessSnapshot {
  const hotelItems = findByTypes(confirmedItems, ["hotel"]);
  const transportItems = findByTypes(confirmedItems, ["transport", "flight"]);
  const returnTransportItems = transportItems.length >= 2 ? transportItems.slice(1) : [];

  const items: ReadinessItem[] = [
    {
      id: "trip-dates",
      tripId: trip.id,
      category: "reservations",
      title: "Trip dates locked",
      description:
        trip.start_date && trip.end_date
          ? `Committed trip dates: ${trip.start_date} to ${trip.end_date}.`
          : "Departure and return dates are not committed yet.",
      severity: "critical",
      status: trip.start_date && trip.end_date ? "completed" : "unknown",
      dueAt: trip.start_date,
      sourceKind: "system",
      evidence:
        trip.start_date && trip.end_date ? [`${trip.start_date} to ${trip.end_date}`] : [],
    },
    {
      id: "documents",
      tripId: trip.id,
      category: "documents",
      title: "Passport and visa readiness confirmed",
      description:
        "No committed traveler document data exists yet. Confirm passport validity and visa requirements manually before departure.",
      severity: "critical",
      status: "unknown",
      dueAt: trip.start_date,
      sourceKind: "system",
      evidence: [],
    },
    {
      id: "stay",
      tripId: trip.id,
      category: "reservations",
      title: "Accommodation booked",
      description: buildItemsDescription(
        hotelItems,
        "No confirmed accommodation item found yet.",
        "stay"
      ),
      severity: "high",
      status: aggregateBookingStatus(hotelItems),
      dueAt: trip.start_date,
      sourceKind: "system",
      evidence: hotelItems.map((item) => item.title),
    },
    {
      id: "primary-transport",
      tripId: trip.id,
      category: "transport",
      title: "Primary transport booked",
      description: buildItemsDescription(
        transportItems,
        "No confirmed flight or transport item found yet.",
        "transport"
      ),
      severity: "critical",
      status: aggregateBookingStatus(transportItems),
      dueAt: trip.start_date,
      sourceKind: "system",
      evidence: transportItems.map((item) => item.title),
    },
    {
      id: "arrival-plan",
      tripId: trip.id,
      category: "meetup",
      title: "Arrival and meetup plan confirmed",
      description:
        transportItems.length > 0 && hotelItems.length > 0
          ? "Core arrival pieces exist, but the final meetup or transfer handoff still needs explicit confirmation."
          : "Arrival meetup or transfer plan cannot be validated until transport and stay are both committed.",
      severity: "high",
      status: transportItems.length > 0 && hotelItems.length > 0 ? "open" : "unknown",
      dueAt: trip.start_date,
      sourceKind: "system",
      evidence: collectEvidence(transportItems, hotelItems),
    },
    {
      id: "return-plan",
      tripId: trip.id,
      category: "return",
      title: "Return journey booked",
      description: buildItemsDescription(
        returnTransportItems,
        "No committed return transport could be confirmed from the current trip data.",
        "return"
      ),
      severity: "high",
      status: returnTransportItems.length > 0
        ? aggregateBookingStatus(returnTransportItems)
        : "unknown",
      dueAt: trip.end_date,
      sourceKind: "system",
      evidence: returnTransportItems.map((item) => item.title),
    },
  ];

  const completedCount = items.filter((item) => item.status === "completed").length;
  const knownCount = items.filter((item) => item.status !== "unknown").length;

  return {
    tripId: trip.id,
    trip: {
      destinationName: trip.destination_name,
      startDate: trip.start_date,
      endDate: trip.end_date,
    },
    confidenceScore: items.length === 0 ? 0 : roundPercent(knownCount / items.length),
    completionPercent: items.length === 0 ? 0 : roundPercent(completedCount / items.length),
    blockers: items.filter(
      (item) =>
        item.status !== "completed" &&
        (item.severity === "critical" || item.severity === "high")
    ),
    items,
    missingInputs: buildMissingInputs(items),
    committedSourceSummary: buildCommittedSummary(trip, hotelItems, transportItems),
  };
}

function findByTypes(
  items: Array<Pick<TripItem, "title" | "item_type" | "booking_status">>,
  types: ItemType[]
) {
  return items.filter((item) => types.includes(item.item_type));
}

/**
 * Convert a group of confirmed items' booking statuses into a single
 * ReadinessStatus for the parent checklist row.
 *
 * - Any item with booking_status='needed' → 'open'  (booking required but not done)
 * - All items 'booked' or 'not_required'  → 'completed'
 * - No items at all                        → 'unknown'
 */
function aggregateBookingStatus(
  items: Array<Pick<TripItem, "booking_status">>
): ReadinessStatus {
  if (items.length === 0) return "unknown";
  const anyNeedBooking = items.some((item) => item.booking_status === "needed");
  if (anyNeedBooking) return "open";
  return "completed";
}

/**
 * Build a human-readable description for a readiness row, taking booking_status
 * into account so the text accurately reflects whether items are decided vs booked.
 */
function buildItemsDescription(
  items: Array<Pick<TripItem, "title" | "booking_status">>,
  emptyMessage: string,
  context: "stay" | "transport" | "return"
): string {
  if (items.length === 0) return emptyMessage;

  const bookedItems = items.filter(
    (item) => item.booking_status === "booked" || item.booking_status === "not_required"
  );
  const pendingItems = items.filter((item) => item.booking_status === "needed");

  if (pendingItems.length === 0) {
    const contextLabel = context === "stay" ? "stay" : "transport";
    return `Confirmed and booked ${contextLabel}: ${items.map((item) => item.title).join(", ")}.`;
  }

  const parts: string[] = [];
  if (bookedItems.length > 0) {
    parts.push(`Booked: ${bookedItems.map((item) => item.title).join(", ")}`);
  }
  parts.push(
    `Decided but not yet booked: ${pendingItems.map((item) => item.title).join(", ")}. Use /booked [item] [ref] once booking is complete.`
  );
  return parts.join(". ");
}

function collectEvidence(
  first: Array<Pick<TripItem, "title">>,
  second: Array<Pick<TripItem, "title">>
) {
  return [...first.map((item) => item.title), ...second.map((item) => item.title)];
}

function buildMissingInputs(items: ReadinessItem[]): string[] {
  return items
    .filter((item) => item.status === "unknown" || item.status === "open")
    .map((item) => {
      if (item.status === "open") {
        // Decision made but booking not yet completed
        return `Complete the booking for: ${item.title}. Use /booked [item] [confirmation ref].`;
      }
      // status === 'unknown' — not even decided yet
      switch (item.id) {
        case "documents":
          return "Confirm passport validity and visa needs for the group.";
        case "stay":
          return "Decide and book accommodation — no confirmed hotel yet.";
        case "primary-transport":
          return "Decide and book the main flight or transport so departure readiness can be validated.";
        case "return-plan":
          return "Add and book the return transport as a committed item.";
        default:
          return `Confirm: ${item.title}.`;
      }
    });
}

function buildCommittedSummary(
  trip: Pick<Trip, "start_date" | "end_date">,
  hotelItems: Array<Pick<TripItem, "title">>,
  transportItems: Array<Pick<TripItem, "title">>
): string[] {
  const summary: string[] = [];

  if (trip.start_date && trip.end_date) {
    summary.push(`Trip dates: ${trip.start_date} to ${trip.end_date}`);
  }
  if (hotelItems.length > 0) {
    summary.push(`Accommodation: ${hotelItems.map((item) => item.title).join(", ")}`);
  }
  if (transportItems.length > 0) {
    summary.push(`Transport: ${transportItems.map((item) => item.title).join(", ")}`);
  }

  return summary;
}

function roundPercent(value: number): number {
  return Math.round(value * 100);
}

import { createAdminClient } from "@/lib/db";
import type { ItemType, Trip, TripItem } from "@/lib/types";

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
    .select("id, title, item_type, stage, confirmed_option_id")
    .eq("trip_id", tripId);

  const confirmedItems = ((items ?? []) as Pick<
    TripItem,
    "id" | "title" | "item_type" | "stage" | "confirmed_option_id"
  >[]).filter((item) => item.stage === "confirmed");

  return buildReadinessSnapshot(
    trip as Pick<Trip, "id" | "destination_name" | "start_date" | "end_date">,
    confirmedItems
  );
}

export function buildReadinessSnapshot(
  trip: Pick<Trip, "id" | "destination_name" | "start_date" | "end_date">,
  confirmedItems: Array<
    Pick<TripItem, "id" | "title" | "item_type" | "confirmed_option_id">
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
      title: "Accommodation committed",
      description:
        hotelItems.length > 0
          ? `Confirmed stay plan found: ${hotelItems.map((item) => item.title).join(", ")}.`
          : "No confirmed accommodation item found yet.",
      severity: "high",
      status: hotelItems.length > 0 ? "completed" : "unknown",
      dueAt: trip.start_date,
      sourceKind: "system",
      evidence: hotelItems.map((item) => item.title),
    },
    {
      id: "primary-transport",
      tripId: trip.id,
      category: "transport",
      title: "Primary transport committed",
      description:
        transportItems.length > 0
          ? `Confirmed transport found: ${transportItems.map((item) => item.title).join(", ")}.`
          : "No confirmed flight or transport item found yet.",
      severity: "critical",
      status: transportItems.length > 0 ? "completed" : "unknown",
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
      title: "Return journey committed",
      description:
        returnTransportItems.length > 0
          ? `Return transport looks committed: ${returnTransportItems
              .map((item) => item.title)
              .join(", ")}.`
          : "No committed return transport could be confirmed from the current trip data.",
      severity: "high",
      status: returnTransportItems.length > 0 ? "completed" : "unknown",
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
  items: Array<Pick<TripItem, "title" | "item_type">>,
  types: ItemType[]
) {
  return items.filter((item) => types.includes(item.item_type));
}

function collectEvidence(
  first: Array<Pick<TripItem, "title">>,
  second: Array<Pick<TripItem, "title">>
) {
  return [...first.map((item) => item.title), ...second.map((item) => item.title)];
}

function buildMissingInputs(items: ReadinessItem[]): string[] {
  return items
    .filter((item) => item.status === "unknown")
    .map((item) => {
      switch (item.id) {
        case "documents":
          return "Confirm passport validity and visa needs for the group.";
        case "stay":
          return "Commit the accommodation choice so operations can rely on it.";
        case "primary-transport":
          return "Commit the main flight or transport so departure readiness can be validated.";
        case "return-plan":
          return "Add the return transport as a committed item.";
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

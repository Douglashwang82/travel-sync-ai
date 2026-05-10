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
    destinationName: string | null;
    destinationPlaceId: string | null;
    destinationFormattedAddress: string | null;
    destinationGoogleMapsUrl: string | null;
    destinationLat: number | null;
    destinationLng: number | null;
    destinationTimezone: string | null;
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
      end_date
    `)
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
    >,
    confirmedItems
  );
}

export function buildReadinessSnapshot(
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
  >,
  confirmedItems: Array<
    Pick<TripItem, "id" | "title" | "item_type" | "confirmed_option_id" | "booking_status">
  >
): ReadinessSnapshot {
  const hotelItems = findByTypes(confirmedItems, ["hotel"]);
  const transportItems = findByTypes(confirmedItems, ["transport", "flight"]);
  const returnTransportItems = transportItems.length >= 2 ? transportItems.slice(1) : [];
  const restaurantItems = findByTypes(confirmedItems, ["restaurant"]);
  const activityItems = findByTypes(confirmedItems, ["activity"]);

  const items: ReadinessItem[] = [
    {
      id: "trip-dates",
      tripId: trip.id,
      category: "reservations",
      title: "旅程日期已確認",
      description:
        trip.start_date && trip.end_date
          ? `已確認旅程日期：${trip.start_date} 到 ${trip.end_date}。`
          : "出發與返程日期尚未確認。",
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
      title: "護照與簽證準備就緒",
      description:
        "尚未有任何已確認的旅客證件資料。出發前請手動確認護照效期與簽證需求。",
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
      title: "住宿已預訂",
      description: buildItemsDescription(
        hotelItems,
        "目前還沒有已確認的住宿項目。",
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
      title: "主要交通已預訂",
      description: buildItemsDescription(
        transportItems,
        "目前還沒有已確認的航班或交通項目。",
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
      title: "抵達與接駁計畫已確認",
      description:
        transportItems.length > 0 && hotelItems.length > 0
          ? "抵達相關的核心資訊已具備，但最後的會合或接駁交接仍需明確確認。"
          : "在交通與住宿都已確認之前，無法驗證抵達會合或接駁計畫。",
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
      title: "返程交通已預訂",
      description: buildItemsDescription(
        returnTransportItems,
        "從目前的旅程資料中找不到任何已確認的返程交通。",
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
    // Only emit restaurant readiness when there are confirmed restaurant items —
    // missing restaurant data is not a blocker for trips without dining reservations.
    ...(restaurantItems.length > 0
      ? [{
          id: "restaurant-reservations",
          tripId: trip.id,
          category: "reservations" as const,
          title: "餐廳訂位已確認",
          description: buildItemsDescription(restaurantItems, "", "stay"),
          severity: "medium" as const,
          status: aggregateBookingStatus(restaurantItems),
          dueAt: trip.start_date,
          sourceKind: "system" as const,
          evidence: restaurantItems.map((item) => item.title),
        }]
      : []),
    // Activity items that need tickets flagged as medium severity — a missed
    // activity is recoverable unlike transport, but still warrants tracking.
    ...(activityItems.length > 0
      ? [{
          id: "activity-tickets",
          tripId: trip.id,
          category: "reservations" as const,
          title: "活動票券與門票已確認",
          description: buildItemsDescription(activityItems, "", "stay"),
          severity: "medium" as const,
          status: aggregateBookingStatus(activityItems),
          dueAt: trip.start_date,
          sourceKind: "system" as const,
          evidence: activityItems.map((item) => item.title),
        }]
      : []),
  ];

  const completedCount = items.filter((item) => item.status === "completed").length;
  const knownCount = items.filter((item) => item.status !== "unknown").length;

  return {
    tripId: trip.id,
    trip: {
      destinationName: trip.destination_name,
      destinationPlaceId: trip.destination_place_id,
      destinationFormattedAddress: trip.destination_formatted_address,
      destinationGoogleMapsUrl: trip.destination_google_maps_url,
      destinationLat: trip.destination_lat,
      destinationLng: trip.destination_lng,
      destinationTimezone: trip.destination_timezone,
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
    const contextLabel = context === "stay" ? "住宿" : context === "return" ? "返程交通" : "交通";
    return `已確認並完成預訂的${contextLabel}：${items.map((item) => item.title).join("、")}。`;
  }

  const parts: string[] = [];
  if (bookedItems.length > 0) {
    parts.push(`已預訂：${bookedItems.map((item) => item.title).join("、")}`);
  }
  parts.push(
    `已決定但尚未預訂：${pendingItems.map((item) => item.title).join("、")}。預訂完成後，請輸入 /booked [項目] [訂位代碼]。`
  );
  return parts.join("；");
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
        return `完成「${item.title}」的預訂。預訂後請輸入 /booked [項目] [訂位代碼]。`;
      }
      // status === 'unknown' — not even decided yet
      switch (item.id) {
        case "documents":
          return "確認群組成員的護照效期與簽證需求。";
        case "stay":
          return "決定並預訂住宿 — 目前還沒有已確認的飯店。";
        case "primary-transport":
          return "決定並預訂主要航班或交通，才能驗證出發就緒度。";
        case "return-plan":
          return "新增並預訂返程交通，並將其列為已確認項目。";
        default:
          return `請確認：${item.title}。`;
      }
    });
}

function buildCommittedSummary(
  trip: Pick<
    Trip,
    | "start_date"
    | "end_date"
    | "destination_place_id"
    | "destination_formatted_address"
    | "destination_google_maps_url"
    | "destination_timezone"
  >,
  hotelItems: Array<Pick<TripItem, "title">>,
  transportItems: Array<Pick<TripItem, "title">>
): string[] {
  const summary: string[] = [];

  if (trip.destination_place_id) {
    summary.push(`目的地代碼：${trip.destination_place_id}`);
  }
  if (trip.destination_formatted_address) {
    summary.push(`目的地地址：${trip.destination_formatted_address}`);
  }
  if (trip.destination_timezone) {
    summary.push(`目的地時區：${trip.destination_timezone}`);
  }
  if (trip.destination_google_maps_url) {
    summary.push(`目的地地圖：${trip.destination_google_maps_url}`);
  }
  if (trip.start_date && trip.end_date) {
    summary.push(`旅程日期：${trip.start_date} 到 ${trip.end_date}`);
  }
  if (hotelItems.length > 0) {
    summary.push(`住宿：${hotelItems.map((item) => item.title).join("、")}`);
  }
  if (transportItems.length > 0) {
    summary.push(`交通：${transportItems.map((item) => item.title).join("、")}`);
  }

  return summary;
}

function roundPercent(value: number): number {
  return Math.round(value * 100);
}


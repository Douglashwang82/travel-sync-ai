import { createAdminClient } from "@/lib/db";
import type { BookingStatus, ItemType, Trip, TripItem, TripItemOption } from "@/lib/types";
import { TripItemMetadataSchema, type TripItemMetadata } from "@/lib/trip-item-metadata";
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
  destinationName: string | null;
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
    bookingStatus: BookingStatus;
    googleMapsUrl: string | null;
    bookingUrl: string | null;
    metadataSummary: string | null;
  }>;
  needsBookingCount: number;
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
      booking_status,
      metadata,
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
    ((items ?? []) as Array<
      Pick<TripItem, "id" | "title" | "item_type" | "stage" | "deadline_at" | "confirmed_option_id" | "booking_status"> & { metadata?: unknown }
    >).map((item) => ({
      ...item,
      confirmed_option: extractConfirmedOption(item),
      metadata: parseItemMetadata(item.metadata, item.item_type),
    })),
    readiness
  );
}

type OpsItem = Pick<
  TripItem,
  "id" | "title" | "item_type" | "stage" | "deadline_at" | "confirmed_option_id" | "booking_status"
> & {
  confirmed_option: Pick<TripItemOption, "google_maps_url" | "booking_url"> | null;
  metadata: TripItemMetadata | null;
};

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
  items: OpsItem[],
  readiness: ReadinessSnapshot | null
): OperationsSummary {
  const phase = deriveTripPhase(trip);
  const confirmedItems = items.filter((item) => item.stage === "confirmed");
  const transportItems = confirmedItems.filter(
    (item) => item.item_type === "flight" || item.item_type === "transport"
  );
  const needsBookingCount = confirmedItems.filter((i) => i.booking_status === "needed").length;

  const readinessBlockers = readiness?.blockers ?? [];

  // Inject a booking nudge when items are confirmed but not yet booked
  const bookingNudges: string[] =
    needsBookingCount > 0
      ? [`${needsBookingCount} confirmed item${needsBookingCount === 1 ? "" : "s"} still need${needsBookingCount === 1 ? "s" : ""} booking — use /booked [item] [ref].`]
      : [];

  const nextActions = [
    ...bookingNudges,
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
        ? transportItems.map((item) => buildTransportStatusLine(item))
        : ["No committed transport is available for live operations yet."],
    confirmedToday: confirmedItems.slice(0, 4).map((item) => item.title),
    readiness: {
      completionPercent: readiness?.completionPercent ?? 0,
      confidenceScore: readiness?.confidenceScore ?? 0,
      blockerCount: readinessBlockers.length,
    },
    needsBookingCount,
    // Include all confirmed items in confirmedLinks, not just those with option URLs.
    // Manually added items have no confirmed_option but still matter operationally.
    confirmedLinks: confirmedItems
      .map((item) => ({
        itemId: item.id,
        title: item.title,
        itemType: item.item_type,
        bookingStatus: item.booking_status,
        googleMapsUrl: item.confirmed_option?.google_maps_url ?? null,
        bookingUrl: item.confirmed_option?.booking_url ?? null,
        metadataSummary: buildMetadataSummary(item.metadata),
      }))
      .slice(0, 8),
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
      return ["先確定旅程日期，並至少敲定一項交通或住宿，再開始大量使用營運功能。"];
    case "countdown":
      return [
        "出發週前用 /ready 確認剩餘阻塞項目。",
        transportItems.length > 0
          ? "再次和官方來源核對出發時間。"
          : "確定主要交通方式，才能驗證出發就緒度。",
      ];
    case "departure":
      return [
        "在群組裡送出一次完整的狀態整理，避免分散通知。",
        trip.start_date
          ? `今天是出發日：${trip.start_date}。請再次確認機場或集合時間。`
          : "請再次確認出發時間。",
      ];
    case "active":
      return ["使用 /brief 取得每日行程摘要。", "把群組更新整理成一則營運訊息送出即可。"];
    case "return":
      return [
        trip.end_date
          ? `返程日：${trip.end_date}。請再次確認退房與交通。`
          : "請再次確認返程時間。",
        "使用 /complete 結束旅程，或用 /exp-summary 結算費用。",
      ];
    case "complete":
      return ["旅程已完成。使用 /exp-summary 結算費用，或用 /start 規劃下一趟旅程。"];
  }
}

function deriveActiveRisks(
  phase: TripPhase,
  readiness: ReadinessSnapshot | null,
  transportItems: Array<Pick<TripItem, "title">>
): string[] {
  const risks: string[] = [];

  if (!readiness || readiness.confidenceScore < 50) {
    risks.push("營運資料尚不完整，請補齊更多已確認細節，再依此檢視。");
  }
  if (transportItems.length === 0 && (phase === "countdown" || phase === "departure" || phase === "return")) {
    risks.push("尚未有已確認的交通可供營運追蹤。");
  }

  return risks;
}

function buildHeadline(
  phase: TripPhase,
  destinationName: string | null,
  nextActionCount: number,
  riskCount: number
): string {
  const phaseLabel = formatPhaseLabel(phase);
  const label = destinationName ?? "這趟旅程";
  return `${label}目前處於${phaseLabel}：${nextActionCount} 項下一步、${riskCount} 項風險。`;
}

function formatPhaseLabel(phase: TripPhase): string {
  switch (phase) {
    case "planning": return "規劃階段";
    case "countdown": return "出發倒數";
    case "departure": return "出發日";
    case "active": return "旅程進行中";
    case "return": return "返程階段";
    case "complete": return "已完成";
  }
}

function buildFreshnessNotes(
  readiness: ReadinessSnapshot | null,
  transportItems: Array<Pick<TripItem, "title">>
): string[] {
  const notes: string[] = [
    "此檢視僅根據已確認的旅程資料，不包含未確認的規劃討論。",
  ];

  if (!readiness) {
    notes.push("目前無法取得就緒度資料。");
  } else if (readiness.confidenceScore < 50) {
    notes.push(
      `就緒度信心度為 ${readiness.confidenceScore}%，缺少的細節會以「未知」呈現。`
    );
  }

  if (transportItems.length === 0) {
    notes.push("尚未捕捉到任何已確認的交通資料，因此目前沒有啟動即時交通監控。");
  } else {
    notes.push("此處顯示的交通資料來自已確認的行程，尚非即時監控狀態。");
  }

  return notes;
}

function formatItemType(itemType: ItemType): string {
  if (itemType === "flight") return "航班";
  if (itemType === "transport") return "交通";
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

function parseItemMetadata(raw: unknown, itemType: string): TripItemMetadata | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const withType = { type: itemType, ...(raw as Record<string, unknown>) };
  const result = TripItemMetadataSchema.safeParse(withType);
  return result.success ? result.data : null;
}

function buildTransportStatusLine(item: OpsItem): string {
  const base = `已確認的${formatItemType(item.item_type)}：${item.title}`;
  if (!item.metadata) return base;

  const parts: string[] = [];
  if (item.metadata.type === "flight") {
    if (item.metadata.flight_number) parts.push(item.metadata.flight_number);
    if (item.metadata.departure_airport && item.metadata.arrival_airport) {
      parts.push(`${item.metadata.departure_airport} → ${item.metadata.arrival_airport}`);
    }
    if (item.metadata.departure_time) {
      parts.push(
        new Date(item.metadata.departure_time).toLocaleTimeString("zh-TW", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        })
      );
    }
  } else if (item.metadata.type === "transport") {
    if (item.metadata.mode) parts.push(item.metadata.mode);
    if (item.metadata.pickup_location) parts.push(item.metadata.pickup_location);
    if (item.metadata.pickup_time) parts.push(item.metadata.pickup_time);
  }

  return parts.length > 0 ? `${base} (${parts.join(" · ")})` : base;
}

function buildMetadataSummary(metadata: TripItemMetadata | null): string | null {
  if (!metadata) return null;
  switch (metadata.type) {
    case "flight": {
      const parts = [
        metadata.flight_number,
        metadata.departure_airport && metadata.arrival_airport
          ? `${metadata.departure_airport}→${metadata.arrival_airport}`
          : null,
      ].filter(Boolean);
      return parts.length > 0 ? parts.join(" ") : null;
    }
    case "hotel":
      return metadata.check_in_time ? `入住 ${metadata.check_in_time}` : null;
    case "restaurant":
      return metadata.reservation_time ? `${metadata.reservation_time}${metadata.party_size ? ` · ${metadata.party_size} 人` : ""}` : null;
    case "transport":
      return metadata.mode ?? null;
    case "activity":
      return metadata.start_time ?? null;
    default:
      return null;
  }
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

import { createAdminClient } from "@/lib/db";
import { getConfirmedItems, type ItineraryRow } from "@/services/trip-items";
import type { TripItemMetadata } from "@/lib/trip-item-metadata";
import { BOT_COPY } from "@/lib/bot-copy";
import type { CommandContext } from "../router";

type TripForItinerary = {
  id: string;
  destination_name: string | null;
  start_date: string | null;
  end_date: string | null;
  day_notes: Record<string, { note?: string }> | null;
};

export async function handleItinerary(
  args: string[],
  ctx: CommandContext,
  reply: (text: string) => Promise<void>
): Promise<void> {
  if (!ctx.dbGroupId) {
    await reply("用法：/itinerary [YYYY-MM-DD]\n範例：/itinerary 2026-07-15");
    return;
  }

  const db = createAdminClient();
  const { data: trip } = await db
    .from("trips")
    .select("id, destination_name, start_date, end_date, day_notes")
    .eq("group_id", ctx.dbGroupId)
    .in("status", ["draft", "active"])
    .single();

  if (!trip) {
    await reply(BOT_COPY.noActiveTrip);
    return;
  }

  const typedTrip = trip as TripForItinerary;
  const requestedDate = parseRequestedDate(args.join(" "), typedTrip);
  if (args.length > 0 && !requestedDate) {
    await reply(
      "我看不懂這個日期。\n" +
        "請使用 /itinerary YYYY-MM-DD 或 /itinerary M/D。\n" +
        "範例：/itinerary 2026-07-15"
    );
    return;
  }

  let items: ItineraryRow[];
  try {
    items = await getConfirmedItems(typedTrip.id);
  } catch (err) {
    console.error("[itinerary] failed to load confirmed items", err);
    await reply("行程載入失敗，請再試一次。");
    return;
  }

  const filteredItems = requestedDate
    ? items.filter((item) => getItemDate(item) === requestedDate)
    : items;

  await reply(formatItinerary(typedTrip, filteredItems, requestedDate));
}

function parseRequestedDate(raw: string, trip: TripForItinerary): string | null {
  const input = raw.trim();
  if (!input) return null;

  const iso = input.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return input;

  const slash = input.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (!slash) return null;

  const year = trip.start_date?.slice(0, 4) ?? new Date().getFullYear().toString();
  const month = slash[1].padStart(2, "0");
  const day = slash[2].padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatItinerary(
  trip: TripForItinerary,
  items: ItineraryRow[],
  requestedDate: string | null
): string {
  const title = requestedDate
    ? `${formatDateLabel(requestedDate)} 的行程`
    : `行程${trip.destination_name ? `：${trip.destination_name}` : ""}`;

  if (items.length === 0) {
    return requestedDate
      ? `${title}\n\n這一天還沒有已確認的安排。`
      : `${title}\n\n目前還沒有已確認的行程。可以使用 /decide、/vote，或從網頁版新增已確認安排。`;
  }

  const lines = [title];
  if (!requestedDate && (trip.start_date || trip.end_date)) {
    lines.push(formatTripDates(trip.start_date, trip.end_date));
  }

  const grouped = groupByDate(items);
  for (const [date, dayItems] of grouped) {
    lines.push("");
    lines.push(date === "undated" ? "未設定日期" : formatDateLabel(date));

    const note = date !== "undated" ? trip.day_notes?.[date]?.note?.trim() : "";
    if (note) lines.push(`備註：${note}`);

    for (const item of dayItems) {
      lines.push(formatItemLine(item));
    }
  }

  return lines.join("\n");
}

function groupByDate(items: ItineraryRow[]): Map<string, ItineraryRow[]> {
  const grouped = new Map<string, ItineraryRow[]>();
  for (const item of items) {
    const date = getItemDate(item) ?? "undated";
    grouped.set(date, [...(grouped.get(date) ?? []), item]);
  }
  return grouped;
}

function getItemDate(item: ItineraryRow): string | null {
  if (item.deadline_at) return item.deadline_at.slice(0, 10);
  const metadataDate = getMetadataDate(item.metadata);
  return metadataDate?.slice(0, 10) ?? null;
}

function getMetadataDate(metadata: TripItemMetadata): string | null {
  if (metadata.type === "flight") return metadata.departure_time ?? null;
  if (metadata.type === "insurance") return metadata.valid_from ?? null;
  return null;
}

function formatItemLine(item: ItineraryRow): string {
  const time = getItemTime(item);
  const option = item.confirmed_option?.name;
  const ref = item.booking_ref ? ` 訂位編號 ${item.booking_ref}` : "";
  const label = option && option !== item.title ? `${item.title}: ${option}` : item.title;
  return `- ${time ? `${time} ` : ""}${label}${ref}`;
}

function getItemTime(item: ItineraryRow): string | null {
  if (item.deadline_at) return item.deadline_at.slice(11, 16);

  const metadata = item.metadata;
  if (metadata.type === "restaurant") return metadata.reservation_time ?? null;
  if (metadata.type === "activity") return metadata.start_time ?? null;
  if (metadata.type === "transport") return metadata.pickup_time ?? null;
  if (metadata.type === "flight" && metadata.departure_time) {
    return metadata.departure_time.slice(11, 16);
  }
  return null;
}

function formatDateLabel(date: string): string {
  return date;
}

function formatTripDates(startDate: string | null, endDate: string | null): string {
  if (startDate && endDate) return `${startDate} 到 ${endDate}`;
  return startDate ?? endDate ?? "";
}

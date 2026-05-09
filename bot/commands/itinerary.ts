import { createAdminClient } from "@/lib/db";
import { getConfirmedItems, type ItineraryRow } from "@/services/trip-items";
import type { TripItemMetadata } from "@/lib/trip-item-metadata";
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
    await reply("Usage: /itinerary [YYYY-MM-DD]\nExample: /itinerary 2026-07-15");
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
    await reply("No active trip. Use /start to create one first.");
    return;
  }

  const typedTrip = trip as TripForItinerary;
  const requestedDate = parseRequestedDate(args.join(" "), typedTrip);
  if (args.length > 0 && !requestedDate) {
    await reply(
      "I couldn't understand that date.\n" +
        "Use /itinerary YYYY-MM-DD or /itinerary M/D.\n" +
        "Example: /itinerary 2026-07-15"
    );
    return;
  }

  let items: ItineraryRow[];
  try {
    items = await getConfirmedItems(typedTrip.id);
  } catch (err) {
    console.error("[itinerary] failed to load confirmed items", err);
    await reply("Failed to load the itinerary. Please try again.");
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
    ? `Itinerary for ${formatDateLabel(requestedDate)}`
    : `Itinerary${trip.destination_name ? `: ${trip.destination_name}` : ""}`;

  if (items.length === 0) {
    return requestedDate
      ? `${title}\n\nNo confirmed plans for this date yet.`
      : `${title}\n\nNo confirmed itinerary items yet. Use /decide, /vote, or add confirmed plans from the web app.`;
  }

  const lines = [title];
  if (!requestedDate && (trip.start_date || trip.end_date)) {
    lines.push(formatTripDates(trip.start_date, trip.end_date));
  }

  const grouped = groupByDate(items);
  for (const [date, dayItems] of grouped) {
    lines.push("");
    lines.push(date === "undated" ? "No date set" : formatDateLabel(date));

    const note = date !== "undated" ? trip.day_notes?.[date]?.note?.trim() : "";
    if (note) lines.push(`Note: ${note}`);

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
  const ref = item.booking_ref ? ` ref ${item.booking_ref}` : "";
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
  if (startDate && endDate) return `${startDate} to ${endDate}`;
  return startDate ?? endDate ?? "";
}

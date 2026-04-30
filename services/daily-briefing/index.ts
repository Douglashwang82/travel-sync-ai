import { createAdminClient } from "@/lib/db";
import { pushText } from "@/lib/line";
import { TripItemMetadataSchema } from "@/lib/trip-item-metadata";
import type { TripItemMetadata } from "@/lib/trip-item-metadata";

export interface DailyBriefingResult {
  tripId: string;
  groupLineId: string;
  itemCount: number;
  sent: boolean;
}

export async function sendDailyBriefings(): Promise<DailyBriefingResult[]> {
  const db = createAdminClient();
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  // Find trips that are currently active and within their travel dates
  const { data: trips } = await db
    .from("trips")
    .select(
      "id, destination_name, start_date, end_date, group_id, line_groups!inner(line_group_id)"
    )
    .eq("status", "active")
    .lte("start_date", today)
    .gte("end_date", today);

  if (!trips?.length) return [];

  const results: DailyBriefingResult[] = [];

  for (const trip of trips) {
    const lineGroup = Array.isArray(trip.line_groups) ? trip.line_groups[0] : trip.line_groups;
    if (!lineGroup?.line_group_id) continue;

    const lineGroupId: string = lineGroup.line_group_id;

    // Pull confirmed (booked) items with option details and metadata
    const { data: items } = await db
      .from("trip_items")
      .select(
        "id, title, item_type, deadline_at, booking_ref, metadata, trip_item_options!trip_items_confirmed_option_id_fkey(name, address, booking_url)"
      )
      .eq("trip_id", trip.id)
      .eq("stage", "confirmed")
      .eq("booking_status", "booked")
      .order("deadline_at", { ascending: true, nullsFirst: false });

    // Also fetch items with deadline today (not yet booked but due today)
    const { data: todayDeadlines } = await db
      .from("trip_items")
      .select("id, title, item_type, deadline_at")
      .eq("trip_id", trip.id)
      .neq("stage", "done")
      .gte("deadline_at", `${today}T00:00:00Z`)
      .lte("deadline_at", `${today}T23:59:59Z`);

    // Items confirmed but still needing booking action today
    const { data: needsBooking } = await db
      .from("trip_items")
      .select("id, title, item_type")
      .eq("trip_id", trip.id)
      .eq("stage", "confirmed")
      .eq("booking_status", "needed");

    const message = buildBriefingMessage(
      trip.destination_name ?? "your trip",
      today,
      items ?? [],
      todayDeadlines ?? [],
      needsBooking ?? []
    );

    try {
      await pushText(lineGroupId, message);
      results.push({
        tripId: trip.id,
        groupLineId: lineGroupId,
        itemCount: (items?.length ?? 0) + (todayDeadlines?.length ?? 0),
        sent: true,
      });
    } catch {
      results.push({
        tripId: trip.id,
        groupLineId: lineGroupId,
        itemCount: 0,
        sent: false,
      });
    }
  }

  return results;
}

type TripItemOption = { name: string | null; address: string | null; booking_url: string | null };

type TripItem = {
  id: string;
  title: string;
  item_type: string;
  deadline_at: string | null;
  booking_ref?: string | null;
  metadata?: unknown;
  // Supabase join returns an array even for a to-one FK
  trip_item_options?: TripItemOption[] | TripItemOption | null;
};

type DeadlineItem = {
  id: string;
  title: string;
  item_type: string;
  deadline_at: string | null;
};

type NeedsBookingItem = {
  id: string;
  title: string;
  item_type: string;
};

function buildBriefingMessage(
  destination: string,
  today: string,
  bookedItems: TripItem[],
  deadlineItems: DeadlineItem[],
  needsBooking: NeedsBookingItem[]
): string {
  const dateLabel = new Date(today + "T12:00:00Z").toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  const TYPE_ICON: Record<string, string> = {
    flight: "✈️",
    hotel: "🏨",
    restaurant: "🍽️",
    activity: "🎯",
    transport: "🚌",
    insurance: "🛡️",
    other: "📌",
  };

  const lines: string[] = [
    `🌅 Good morning! Here's your trip plan for today.`,
    `📍 ${destination} — ${dateLabel}`,
  ];

  if (bookedItems.length > 0) {
    lines.push("\n✅ Confirmed for today:");
    for (const item of bookedItems) {
      const icon = TYPE_ICON[item.item_type] ?? "📌";
      const opt = Array.isArray(item.trip_item_options)
        ? (item.trip_item_options[0] ?? null)
        : (item.trip_item_options ?? null);
      const name = opt?.name ?? item.title;
      const metadata = parseMetadata(item.metadata, item.item_type);

      // Prefer metadata-derived time over deadline_at for precision
      const timeStr = pickDisplayTime(metadata, item.deadline_at);

      let line = `  ${icon} ${name}`;
      if (timeStr) line += ` @ ${timeStr}`;
      if (item.booking_ref) line += ` · Ref: ${item.booking_ref}`;
      if (opt?.address) line += `\n     📍 ${opt.address}`;

      // Type-specific detail lines
      const detail = buildMetadataDetail(metadata);
      if (detail) line += `\n     ${detail}`;

      if (opt?.booking_url) line += `\n     🔗 ${opt.booking_url}`;
      lines.push(line);
    }
  }

  if (deadlineItems.length > 0) {
    lines.push("\n⏰ Due today:");
    for (const item of deadlineItems) {
      const icon = TYPE_ICON[item.item_type] ?? "📌";
      lines.push(`  ${icon} ${item.title}`);
    }
  }

  if (needsBooking.length > 0) {
    lines.push("\n⚠️ Still needs booking:");
    for (const item of needsBooking) {
      const icon = TYPE_ICON[item.item_type] ?? "📌";
      lines.push(`  ${icon} ${item.title} — use /booked ${item.title} [ref] when done`);
    }
  }

  if (bookedItems.length === 0 && deadlineItems.length === 0) {
    lines.push("\nNo confirmed activities on the schedule today. Enjoy your free time! 🎉");
  }

  lines.push("\n🛠 /ops for full trip status · /incident if something goes wrong");

  return lines.join("\n");
}

// ─── Metadata helpers ─────────────────────────────────────────────────────────

function parseMetadata(raw: unknown, itemType: string): TripItemMetadata | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const withType = { type: itemType, ...(raw as Record<string, unknown>) };
  const result = TripItemMetadataSchema.safeParse(withType);
  return result.success ? result.data : null;
}

function pickDisplayTime(metadata: TripItemMetadata | null, deadlineAt: string | null): string | null {
  // Prefer the semantically precise field from metadata over the generic deadline_at
  if (metadata?.type === "flight" && metadata.departure_time) {
    return formatTime(metadata.departure_time);
  }
  if (metadata?.type === "restaurant" && metadata.reservation_time) {
    return formatTime(metadata.reservation_time);
  }
  if (metadata?.type === "activity" && metadata.start_time) {
    return formatTime(metadata.start_time);
  }
  if (metadata?.type === "transport" && metadata.pickup_time) {
    return formatTime(metadata.pickup_time);
  }
  if (deadlineAt) {
    return formatTime(deadlineAt);
  }
  return null;
}

function buildMetadataDetail(metadata: TripItemMetadata | null): string | null {
  if (!metadata) return null;

  switch (metadata.type) {
    case "flight": {
      const parts: string[] = [];
      if (metadata.flight_number) parts.push(metadata.flight_number);
      if (metadata.departure_airport && metadata.arrival_airport) {
        parts.push(`${metadata.departure_airport} → ${metadata.arrival_airport}`);
      }
      if (metadata.terminal) parts.push(`Terminal ${metadata.terminal}`);
      if (metadata.gate) parts.push(`Gate ${metadata.gate}`);
      if (metadata.seat) parts.push(`Seat ${metadata.seat}`);
      return parts.length > 0 ? `✈️ ${parts.join(" · ")}` : null;
    }
    case "hotel": {
      const parts: string[] = [];
      if (metadata.check_in_time) parts.push(`Check-in ${metadata.check_in_time}`);
      if (metadata.check_out_time) parts.push(`Check-out ${metadata.check_out_time}`);
      if (metadata.room_type) parts.push(metadata.room_type);
      return parts.length > 0 ? `🏨 ${parts.join(" · ")}` : null;
    }
    case "restaurant": {
      const parts: string[] = [];
      if (metadata.party_size) parts.push(`${metadata.party_size} pax`);
      if (metadata.cuisine) parts.push(metadata.cuisine);
      if (metadata.phone) parts.push(`📞 ${metadata.phone}`);
      return parts.length > 0 ? `🍽️ ${parts.join(" · ")}` : null;
    }
    case "transport": {
      const parts: string[] = [];
      if (metadata.mode) parts.push(metadata.mode);
      if (metadata.pickup_location) parts.push(`From: ${metadata.pickup_location}`);
      if (metadata.dropoff_location) parts.push(`To: ${metadata.dropoff_location}`);
      if (metadata.provider) parts.push(metadata.provider);
      return parts.length > 0 ? `🚌 ${parts.join(" · ")}` : null;
    }
    case "activity": {
      const parts: string[] = [];
      if (metadata.duration_minutes) parts.push(`${metadata.duration_minutes} min`);
      if (metadata.meeting_point) parts.push(`Meet: ${metadata.meeting_point}`);
      return parts.length > 0 ? `🎯 ${parts.join(" · ")}` : null;
    }
    case "insurance": {
      const parts: string[] = [];
      if (metadata.provider) parts.push(metadata.provider);
      if (metadata.emergency_contact) parts.push(`Emergency: ${metadata.emergency_contact}`);
      return parts.length > 0 ? `🛡️ ${parts.join(" · ")}` : null;
    }
    default:
      return null;
  }
}

function formatTime(value: string): string {
  const d = new Date(value);
  if (!Number.isNaN(d.getTime())) {
    return d.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }
  // Already a "HH:MM" string
  return value;
}

import { createAdminClient } from "@/lib/db";
import { pushText } from "@/lib/line";

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

    // Pull confirmed (booked) items with their option details
    const { data: items } = await db
      .from("trip_items")
      .select(
        "id, title, item_type, deadline_at, booking_ref, trip_item_options!trip_items_confirmed_option_id_fkey(name, address, booking_url)"
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

    const message = buildBriefingMessage(
      trip.destination_name ?? "your trip",
      today,
      items ?? [],
      todayDeadlines ?? []
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
  // Supabase join returns an array even for a to-one FK
  trip_item_options?: TripItemOption[] | TripItemOption | null;
};

type DeadlineItem = {
  id: string;
  title: string;
  item_type: string;
  deadline_at: string | null;
};

function buildBriefingMessage(
  destination: string,
  today: string,
  bookedItems: TripItem[],
  deadlineItems: DeadlineItem[]
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
      const time = item.deadline_at
        ? new Date(item.deadline_at).toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          })
        : null;

      let line = `  ${icon} ${name}`;
      if (time) line += ` @ ${time}`;
      if (item.booking_ref) line += ` · Ref: ${item.booking_ref}`;
      if (opt?.address) line += `\n     📍 ${opt.address}`;
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

  if (bookedItems.length === 0 && deadlineItems.length === 0) {
    lines.push("\nNo confirmed activities on the schedule today. Enjoy your free time! 🎉");
  }

  lines.push("\n🛠 /ops for full trip status · /incident if something goes wrong");

  return lines.join("\n");
}

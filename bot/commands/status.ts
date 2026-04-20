import { createAdminClient } from "@/lib/db";
import { getLiffUrls, hasLiffConfigured } from "@/lib/liff";
import type { CommandContext, Reply } from "../router";

type TripItem = {
  title: string;
  stage: string;
};

function formatDateRange(startDate: string | null, endDate: string | null): string {
  if (startDate && endDate) {
    return `${startDate} -> ${endDate}`;
  }

  return "Dates TBD";
}

function formatTextList(list: TripItem[], bullet: string): string {
  if (list.length === 0) {
    return "  (empty)";
  }

  return list.map((item) => `  ${bullet} ${item.title}`).join("\n");
}

function formatFlexSection(list: TripItem[], emptyText: string): string {
  if (list.length === 0) {
    return emptyText;
  }

  const visibleItems = list.slice(0, 4).map((item) => `• ${item.title}`);
  const hiddenCount = list.length - visibleItems.length;

  if (hiddenCount > 0) {
    visibleItems.push(`+${hiddenCount} more`);
  }

  return visibleItems.join("\n");
}

export async function handleStatus(
  ctx: CommandContext,
  reply: Reply
): Promise<void> {
  if (!ctx.dbGroupId) {
    await reply("No active trip found. Use /start to create one.");
    return;
  }

  const db = createAdminClient();

  const { data: trip } = await db
    .from("trips")
    .select("id, destination_name, start_date, end_date")
    .eq("group_id", ctx.dbGroupId)
    .in("status", ["draft", "active"])
    .single();

  if (!trip) {
    await reply("No active trip found. Use /start [destination] [dates] to begin.");
    return;
  }

  const { data: items } = await db
    .from("trip_items")
    .select("title, stage")
    .eq("trip_id", trip.id)
    .order("created_at", { ascending: true });

  const todo = items?.filter((item) => item.stage === "todo") ?? [];
  const pending = items?.filter((item) => item.stage === "pending") ?? [];
  const confirmed = items?.filter((item) => item.stage === "confirmed") ?? [];

  const dateStr = formatDateRange(trip.start_date, trip.end_date);
  const summaryText =
    `Trip Board - ${trip.destination_name} (${dateStr})\n\n` +
    `To-Do (${todo.length})\n${formatTextList(todo, "•")}\n\n` +
    `Pending (${pending.length})\n${formatTextList(pending, "⏳")}\n\n` +
    `Confirmed (${confirmed.length})\n${formatTextList(confirmed, "✅")}`;

  const { dashboard, itinerary } = getLiffUrls();
  if (!hasLiffConfigured() || !dashboard) {
    await reply(summaryText);
    return;
  }
  await reply({
    type: "flex",
    altText:
      `Trip Board for ${trip.destination_name}: ` +
      `${todo.length} todo, ${pending.length} pending, ${confirmed.length} confirmed.`,
    contents: {
      type: "bubble",
      size: "giga",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          {
            type: "text",
            text: "Trip Board",
            weight: "bold",
            size: "xl",
          },
          {
            type: "text",
            text: trip.destination_name,
            size: "lg",
            weight: "bold",
            wrap: true,
          },
          {
            type: "text",
            text: dateStr,
            size: "sm",
            color: "#6B7280",
            wrap: true,
          },
          {
            type: "separator",
            margin: "md",
          },
          {
            type: "box",
            layout: "vertical",
            spacing: "sm",
            margin: "md",
            contents: [
              {
                type: "text",
                text: `To-Do (${todo.length})`,
                weight: "bold",
                size: "sm",
              },
              {
                type: "text",
                text: formatFlexSection(todo, "Nothing queued yet."),
                wrap: true,
                size: "sm",
              },
              {
                type: "text",
                text: `Pending (${pending.length})`,
                weight: "bold",
                size: "sm",
                margin: "md",
              },
              {
                type: "text",
                text: formatFlexSection(pending, "No pending items."),
                wrap: true,
                size: "sm",
              },
              {
                type: "text",
                text: `Confirmed (${confirmed.length})`,
                weight: "bold",
                size: "sm",
                margin: "md",
              },
              {
                type: "text",
                text: formatFlexSection(confirmed, "No confirmed bookings yet."),
                wrap: true,
                size: "sm",
              },
            ],
          },
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: [
          {
            type: "button",
            style: "primary",
            height: "sm",
            action: {
              type: "uri",
              label: "Open Dashboard",
              uri: dashboard,
            },
          },
          ...(itinerary
            ? [
                {
                  type: "button" as const,
                  style: "secondary" as const,
                  height: "sm" as const,
                  action: {
                    type: "uri" as const,
                    label: "Open Itinerary",
                    uri: itinerary,
                  },
                },
              ]
            : []),
        ],
      },
    },
  });
}

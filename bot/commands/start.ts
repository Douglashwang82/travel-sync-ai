import { z } from "zod";
import { createAdminClient } from "@/lib/db";
import { track } from "@/lib/analytics";
import type { CommandContext } from "../router";

/**
 * Parse a date range string like "7/15-7/20" or "7/15" into ISO dates.
 * Assumes the current or next calendar year.
 */
function parseDateRange(
  raw: string
): { startDate: string; endDate: string } | null {
  const rangeMatch = raw.match(/^(\d{1,2})\/(\d{1,2})-(\d{1,2})\/(\d{1,2})$/);
  if (rangeMatch) {
    const [, sm, sd, em, ed] = rangeMatch;
    const year = new Date().getFullYear();
    const start = new Date(year, parseInt(sm) - 1, parseInt(sd));
    const end = new Date(year, parseInt(em) - 1, parseInt(ed));
    // Roll to next year if date already passed
    if (start < new Date()) {
      start.setFullYear(year + 1);
      end.setFullYear(year + 1);
    }
    return {
      startDate: start.toISOString().split("T")[0],
      endDate: end.toISOString().split("T")[0],
    };
  }
  return null;
}

const ArgsSchema = z.array(z.string()).min(1, "Destination is required");

export async function handleStart(
  args: string[],
  ctx: CommandContext,
  reply: (text: string) => Promise<void>
): Promise<void> {
  const argsResult = ArgsSchema.safeParse(args);
  if (!argsResult.success || !ctx.dbGroupId || !ctx.userId) {
    await reply(
      "Usage: /start [destination] [dates]\nExample: /start Osaka 7/15-7/20"
    );
    return;
  }

  const db = createAdminClient();

  // Check for an existing active/draft trip
  const { data: existing } = await db
    .from("trips")
    .select("id, destination_name, status")
    .eq("group_id", ctx.dbGroupId)
    .in("status", ["draft", "active"])
    .single();

  if (existing) {
    await reply(
      `There's already an active trip to ${existing.destination_name}.\n` +
        `Use /status to view it, or ask me to cancel it first.`
    );
    return;
  }

  // Parse destination and optional dates from args
  // Last arg is treated as dates if it contains "/"
  let destination: string;
  let startDate: string | null = null;
  let endDate: string | null = null;

  const lastArg = args[args.length - 1];
  if (args.length > 1 && lastArg.includes("/")) {
    destination = args.slice(0, -1).join(" ");
    const parsed = parseDateRange(lastArg);
    if (parsed) {
      startDate = parsed.startDate;
      endDate = parsed.endDate;
    } else {
      // Treat everything as destination if date parse fails
      destination = args.join(" ");
    }
  } else {
    destination = args.join(" ");
  }

  const { data: trip, error } = await db
    .from("trips")
    .insert({
      group_id: ctx.dbGroupId,
      destination_name: destination,
      start_date: startDate,
      end_date: endDate,
      status: "active",
      created_by_user_id: ctx.userId,
    })
    .select("id")
    .single();

  if (error || !trip) {
    console.error("[start] failed to create trip", error);
    await reply("Something went wrong creating the trip. Please try again.");
    return;
  }

  // Update organizer role
  await db
    .from("group_members")
    .upsert(
      {
        group_id: ctx.dbGroupId,
        line_user_id: ctx.userId,
        role: "organizer",
      },
      { onConflict: "group_id,line_user_id" }
    );

  await track("trip_created", {
    groupId: ctx.dbGroupId,
    userId: ctx.userId,
    properties: {
      destination,
      start_date: startDate,
      end_date: endDate,
    },
  });

  const dateStr =
    startDate && endDate
      ? `\n📅 ${startDate} → ${endDate}`
      : "\n📅 Dates not set (use /add or just mention them in chat)";

  await reply(
    `Trip created! ✈️\n\n` +
      `📍 Destination: ${destination}` +
      dateStr +
      `\n\nI'll start tracking travel-related messages. ` +
      `Use /add for planning items, /recommend to recall knowledge, or /decide to set up a group decision.\n\n` +
      `Type /status to see the trip board.`
  );
}

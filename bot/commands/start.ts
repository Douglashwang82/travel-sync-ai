import { createAdminClient } from "@/lib/db";
import { track } from "@/lib/analytics";
import { enrichTripDestinationMetadata } from "@/services/trips/destination";
import type { CommandContext } from "../router";

/**
 * Parse a date range string like "7/15-7/20" into ISO dates.
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

function parseStartArgs(args: string[]): {
  destination: string | null;
  startDate: string | null;
  endDate: string | null;
} {
  if (args.length === 0) {
    return { destination: null, startDate: null, endDate: null };
  }

  const lastArg = args[args.length - 1];
  if (args.length > 1 && lastArg.includes("/")) {
    const parsed = parseDateRange(lastArg);
    if (parsed) {
      return {
        destination: args.slice(0, -1).join(" "),
        startDate: parsed.startDate,
        endDate: parsed.endDate,
      };
    }
  }

  return { destination: args.join(" "), startDate: null, endDate: null };
}

export async function handleStart(
  args: string[],
  ctx: CommandContext,
  reply: (text: string) => Promise<void>
): Promise<void> {
  if (!ctx.dbGroupId || !ctx.userId) {
    await reply("I can't start a trip here — please try from a LINE group.");
    return;
  }

  const db = createAdminClient();

  const { data: existing } = await db
    .from("trips")
    .select("id, destination_name, status")
    .eq("group_id", ctx.dbGroupId)
    .in("status", ["draft", "active"])
    .single();

  if (existing) {
    const label = existing.destination_name
      ? `to ${existing.destination_name}`
      : "in progress";
    await reply(
      `There's already a trip ${label}.\n` +
        `Use /status to view it, or /cancel to cancel it first.`
    );
    return;
  }

  const { destination, startDate, endDate } = parseStartArgs(args);

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

  await db.from("group_members").upsert(
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

  if (destination) {
    await enrichTripDestinationMetadata(trip.id, destination);
  }

  if (!destination && !startDate && !endDate) {
    await reply(
      `Trip started! ✈️\n\n` +
        `No destination, dates, or participants locked in yet — that's fine, we can decide together.\n\n` +
        `Try:\n` +
        `• /idea destination Kyoto — brainstorm a spot\n` +
        `• /decide destination — put it to a group vote\n` +
        `• /add Pick travel dates — add a planning to-do\n\n` +
        `Type /status any time to see the trip board.`
    );
    return;
  }

  const destinationLine = destination
    ? `\n📍 Destination: ${destination}`
    : `\n📍 Destination: not set yet (use /idea or /decide to plan it)`;
  const dateLine =
    startDate && endDate
      ? `\n📅 ${startDate} → ${endDate}`
      : `\n📅 Dates: not set yet (mention them in chat or /add to plan)`;

  await reply(
    `Trip started! ✈️` +
      destinationLine +
      dateLine +
      `\n\nI'll start tracking travel-related messages. ` +
      `Use /add for planning items, /recommend to recall knowledge, or /decide to set up a group vote.\n\n` +
      `Type /status to see the trip board.`
  );
}

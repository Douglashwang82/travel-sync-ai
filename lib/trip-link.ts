import * as line from "@line/bot-sdk";
import { createAdminClient } from "./db";
import { BOT_COPY } from "./bot-copy";

/**
 * Build a trip URL from an explicit trip id, with optional subpage.
 * Returns null when NEXT_PUBLIC_APP_URL is not configured so callers can
 * gracefully skip the link instead of sending a broken one.
 */
export function buildTripUrl(
  tripId: string,
  page: string = "/board"
): string | null {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  if (!base) return null;
  return `${base}/app/trips/${tripId}${page}`;
}

/**
 * Resolve the URL of the most recently active trip for a LINE group.
 * Returns null when there is no group, no trip, or no app URL configured.
 */
export async function getTripUrlForGroup(
  dbGroupId: string | null | undefined,
  page: string = "/board"
): Promise<string | null> {
  if (!dbGroupId) return null;
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  if (!base) return null;

  const db = createAdminClient();
  const { data: trip } = await db
    .from("trips")
    .select("id")
    .eq("group_id", dbGroupId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return trip?.id ? `${base}/app/trips/${trip.id}${page}` : null;
}

/**
 * Resolve the trip URL for the trip that owns a given trip_item.
 */
export async function getTripUrlForItem(
  tripItemId: string,
  page: string = "/board"
): Promise<string | null> {
  const db = createAdminClient();
  const { data: item } = await db
    .from("trip_items")
    .select("trip_id")
    .eq("id", tripItemId)
    .maybeSingle();
  return item?.trip_id ? buildTripUrl(item.trip_id as string, page) : null;
}

/**
 * Append the trip URL to a plain-text message. Safe no-op when url is null.
 */
export function appendTripLinkText(message: string, url: string | null): string {
  if (!url) return message;
  return `${message}\n\n${BOT_COPY.viewLink(url)}`;
}

/**
 * Add a trip link footer to a Flex bubble. No-op for non-bubble containers
 * (carousels, missing body) so callers don't have to special-case.
 */
export function withFlexTripLink(
  contents: line.messagingApi.FlexContainer,
  url: string | null
): line.messagingApi.FlexContainer {
  if (!url) return contents;
  if (contents.type !== "bubble" || contents.body?.type !== "box") return contents;
  return {
    ...contents,
    body: {
      ...contents.body,
      contents: [
        ...contents.body.contents,
        { type: "separator", margin: "md" },
        {
          type: "text",
          text: BOT_COPY.viewLink(url),
          size: "xs",
          color: "#3B82F6",
          wrap: true,
          action: { type: "uri", label: BOT_COPY.viewLabel, uri: url },
        },
      ],
    },
  };
}

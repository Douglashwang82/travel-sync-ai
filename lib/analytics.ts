import { createAdminClient } from "./db";

type AnalyticsEventName =
  | "bot_added_to_group"
  | "trip_created"
  | "message_parsed"
  | "vote_initiated"
  | "vote_cast"
  | "vote_completed"
  | "liff_opened"
  | "nudge_sent"
  | "nudge_conversion"
  | "bot_removed";

interface TrackOptions {
  groupId?: string;
  userId?: string;
  properties?: Record<string, unknown>;
}

export async function track(
  eventName: AnalyticsEventName,
  options: TrackOptions = {}
): Promise<void> {
  const db = createAdminClient();
  await db.from("analytics_events").insert({
    event_name: eventName,
    group_id: options.groupId ?? null,
    user_id: options.userId ?? null,
    properties: options.properties ?? {},
  });
}

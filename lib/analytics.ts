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
  | "bot_removed"
  | "daily_digest_sent"
  | "incident_started"
  | "ops_command_used"
  | "ops_view_opened"
  // Booking lifecycle events
  | "booking_prompt_sent"
  | "booking_confirmed"
  | "booking_reminder_sent"
  | "trip_cancelled"
  | "trip_completed"
  | "budget_set"
  | "idea_submitted";

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

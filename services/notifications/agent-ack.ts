import { createAdminClient } from "@/lib/db";
import { pushText } from "@/lib/line";

/**
 * Push a short ack to the trip's LINE group when an agent has done something
 * the group should know about (e.g. itinerary drafter just added 5 ideas).
 *
 * Best-effort. Trips without a LINE group, or pushes that fail, are silent —
 * the failure is already tracked in `outbound_messages` by `pushText`.
 */
export async function pushAgentAck(tripId: string, text: string): Promise<void> {
  const lineGroupId = await resolveLineGroupId(tripId);
  if (!lineGroupId) return;

  try {
    await pushText(lineGroupId, text, lineGroupId);
  } catch (err) {
    console.warn(
      `[agent-ack] push failed for trip ${tripId}:`,
      err instanceof Error ? err.message : err,
    );
  }
}

async function resolveLineGroupId(tripId: string): Promise<string | null> {
  const db = createAdminClient();
  const { data: trip } = await db
    .from("trips")
    .select("group_id")
    .eq("id", tripId)
    .single();
  if (!trip?.group_id) return null;

  const { data: group } = await db
    .from("line_groups")
    .select("line_group_id, status")
    .eq("id", trip.group_id)
    .single();
  if (!group?.line_group_id) return null;
  if (group.status === "removed" || group.status === "archived") return null;

  return group.line_group_id as string;
}

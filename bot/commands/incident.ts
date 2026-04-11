import { createAdminClient } from "@/lib/db";
import { track } from "@/lib/analytics";
import type { CommandContext } from "../router";
import {
  resolveIncident,
  renderIncidentChatMessage,
  type IncidentFollowUpTask,
} from "@/services/incidents";

export async function handleIncident(
  args: string[],
  ctx: CommandContext,
  reply: (text: string) => Promise<void>
): Promise<void> {
  if (!ctx.dbGroupId) {
    await reply("No active trip found. Use /start to create one first.");
    return;
  }

  const query = args.join(" ").trim();
  if (!query) {
    await reply(
      "Usage: /incident [what happened]\nExample: /incident I lost my passport"
    );
    return;
  }

  const db = createAdminClient();
  const { data: trip } = await db
    .from("trips")
    .select("id, destination_name")
    .eq("group_id", ctx.dbGroupId)
    .in("status", ["draft", "active"])
    .single();

  if (!trip) {
    await reply("No active trip found. Use /start to create one first.");
    return;
  }

  const resolution = resolveIncident(query);

  if (!resolution.matched || !resolution.playbook) {
    await reply(
      "I couldn't confidently map that to a supported incident yet.\n\n" +
        "Try describing it more directly, like:\n" +
        "- /incident flight delay\n" +
        "- /incident I lost my passport\n" +
        "- /incident we can't find the group"
    );
    return;
  }

  const createdTasks = await ensureIncidentTasks(trip.id, resolution.playbook.followUpTasks);

  await track("incident_started", {
    groupId: ctx.dbGroupId,
    userId: ctx.userId,
    properties: {
      trip_id: trip.id,
      incident_type: resolution.playbook.incidentType,
      query,
      confidence: resolution.matchConfidence,
      created_follow_up_count: createdTasks.length,
    },
  });

  const followUpText =
    createdTasks.length > 0
      ? `\n\nAdded follow-up items to the board:\n${createdTasks
          .map((task) => `- ${task.title}`)
          .join("\n")}`
      : "";

  await reply(renderIncidentChatMessage(resolution.playbook) + followUpText);
}

async function ensureIncidentTasks(
  tripId: string,
  tasks: IncidentFollowUpTask[]
): Promise<IncidentFollowUpTask[]> {
  if (tasks.length === 0) return [];

  const db = createAdminClient();
  const created: IncidentFollowUpTask[] = [];

  for (const task of tasks) {
    const { data: existing } = await db
      .from("trip_items")
      .select("id")
      .eq("trip_id", tripId)
      .eq("title", task.title)
      .limit(1)
      .single();

    if (existing) continue;

    const { error } = await db.from("trip_items").insert({
      trip_id: tripId,
      title: task.title,
      item_type: task.itemType,
      item_kind: "task",
      stage: "todo",
      source: "system",
      description: "Created from an incident playbook.",
    });

    if (!error) {
      created.push(task);
    }
  }

  return created;
}

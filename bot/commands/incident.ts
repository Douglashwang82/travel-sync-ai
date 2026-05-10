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
    await reply("目前沒有進行中的旅程。請先使用 /start 建立旅程。");
    return;
  }

  const query = args.join(" ").trim();
  if (!query) {
    await reply(
      "用法：/incident [發生了什麼]\n範例：/incident 我的護照不見了"
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
    await reply("目前沒有進行中的旅程。請先使用 /start 建立旅程。");
    return;
  }

  const resolution = resolveIncident(query);

  if (!resolution.matched || !resolution.playbook) {
    await reply(
      "我目前無法確定這對應到哪個支援的事件類型。\n\n" +
        "可以更直接地描述，例如：\n" +
        "- /incident 班機延誤\n" +
        "- /incident 護照不見了\n" +
        "- /incident 找不到同行的人"
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
      ? `\n\n已在看板上新增後續任務：\n${createdTasks
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
      description: "由事件處理流程自動建立。",
    });

    if (!error) {
      created.push(task);
    }
  }

  return created;
}

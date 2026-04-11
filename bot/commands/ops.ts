import { createAdminClient } from "@/lib/db";
import { track } from "@/lib/analytics";
import type { CommandContext } from "../router";
import { getOperationsSummary } from "@/services/operations";

export async function handleOps(
  ctx: CommandContext,
  reply: (text: string) => Promise<void>
): Promise<void> {
  if (!ctx.dbGroupId) {
    await reply("No active trip found. Use /start to create one first.");
    return;
  }

  const db = createAdminClient();
  const { data: trip } = await db
    .from("trips")
    .select("id")
    .eq("group_id", ctx.dbGroupId)
    .in("status", ["draft", "active"])
    .single();

  if (!trip) {
    await reply("No active trip found. Use /start to create one first.");
    return;
  }

  const summary = await getOperationsSummary(trip.id);
  if (!summary) {
    await reply("I couldn't build an operations summary for this trip yet.");
    return;
  }

  await track("ops_command_used", {
    groupId: ctx.dbGroupId,
    userId: ctx.userId,
    properties: {
      trip_id: trip.id,
      phase: summary.phase,
      degraded: summary.freshness.degraded,
    },
  });

  const lines = [
    `Ops - ${summary.destinationName}`,
    summary.headline,
    "",
    `Phase: ${summary.phase}`,
    `Readiness: ${summary.readiness.completionPercent}% complete, ${summary.readiness.confidenceScore}% confidence`,
    "",
    "Next actions:",
    ...(summary.nextActions.length > 0
      ? summary.nextActions.map((item) => `- ${item}`)
      : ["- No immediate action from committed data."]),
    "",
    "Active risks:",
    ...(summary.activeRisks.length > 0
      ? summary.activeRisks.map((item) => `- ${item}`)
      : ["- No major operational risks detected from committed data."]),
    "",
    "Freshness:",
    ...summary.freshness.notes.map((item) => `- ${item}`),
  ];

  await reply(lines.join("\n"));
}

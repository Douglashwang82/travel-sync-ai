import { createAdminClient } from "@/lib/db";
import type { CommandContext } from "../router";
import { getReadinessSnapshot } from "@/services/readiness";

export async function handleReady(
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

  const snapshot = await getReadinessSnapshot(trip.id);
  if (!snapshot) {
    await reply("I couldn't build a readiness summary for this trip yet.");
    return;
  }

  const intro =
    snapshot.confidenceScore < 50
      ? `I only have partial committed trip details right now (${snapshot.confidenceScore}% confidence).`
      : `This readiness summary is based on committed trip details only (${snapshot.confidenceScore}% confidence).`;

  const completed = snapshot.items.filter((item) => item.status === "completed");
  // Separate "open" (decided, not booked) from other blockers so bookings stand out
  const bookingNeeded = snapshot.blockers.filter((item) => item.status === "open");
  const otherBlockers = snapshot.blockers
    .filter((item) => item.status !== "open")
    .slice(0, 3);
  const missingInputs = snapshot.missingInputs
    .filter((input) => !input.toLowerCase().includes("booking"))
    .slice(0, 3);
  const bookingInputs = snapshot.missingInputs.filter((input) =>
    input.toLowerCase().includes("booking")
  );

  const lines = [
    `Readiness - ${snapshot.trip.destinationName}`,
    intro,
    `Completion: ${snapshot.completionPercent}%`,
  ];

  // Surface unbooked items first — most actionable gap
  if (bookingNeeded.length > 0) {
    lines.push("", "⚠️ Decided but not yet booked:");
    lines.push(...bookingNeeded.map((item) => `- ${item.title}`));
    lines.push(...bookingInputs.map((input) => `  ${input}`));
  }

  lines.push(
    "",
    "Committed source of truth:",
    ...(snapshot.committedSourceSummary.length > 0
      ? snapshot.committedSourceSummary.map((entry) => `- ${entry}`)
      : ["- No committed execution details yet."]),
    "",
    "Completed:",
    ...(completed.length > 0
      ? completed.map((item) => `- ${item.title}`)
      : ["- Nothing fully confirmed yet."])
  );

  if (otherBlockers.length > 0) {
    lines.push("", "Needs attention:");
    lines.push(...otherBlockers.map((item) => `- ${item.title}: ${item.description}`));
  }

  if (missingInputs.length > 0) {
    lines.push("", "Best next inputs:");
    lines.push(...missingInputs.map((item) => `- ${item}`));
  }

  lines.push("", "This summary avoids guesswork and does not use unconfirmed planning ideas.");

  await reply(lines.join("\n"));
}

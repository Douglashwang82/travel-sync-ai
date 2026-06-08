import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAppTripAccess } from "@/lib/app-server";
import { addDispatchedTask, listDispatchedTasks } from "@/services/orchestrator";
import type { DispatchedTask } from "@/services/orchestrator";

type RouteContext = { params: Promise<{ tripId: string }> };

export interface DispatchedTasksResponse {
  tasks: DispatchedTask[];
}

export interface DispatchTaskResponse {
  task: DispatchedTask;
}

/**
 * GET /api/app/trips/:tripId/dispatched-tasks
 * The member-dispatched task list (newest first) for the rail's "Dispatched
 * tasks" section. Visible to every group member; polled while any are running.
 */
export async function GET(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const { tripId } = await ctx.params;
  const auth = await requireAppTripAccess(req, tripId);
  if (!auth.ok) return auth.response;

  const tasks = await listDispatchedTasks(tripId);
  return NextResponse.json<DispatchedTasksResponse>({ tasks });
}

const DispatchSchema = z.object({
  text: z.string().trim().min(1).max(2000),
  messageId: z.string().min(1).max(200).optional(),
});

/**
 * POST /api/app/trips/:tripId/dispatched-tasks
 * Dispatch a task to the AI planner (a dropped chat bubble). Records it as
 * `pending` and triggers a focused tool-use run out-of-band; returns the task
 * immediately so the UI can show it resolving.
 */
export async function POST(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const { tripId } = await ctx.params;
  const auth = await requireAppTripAccess(req, tripId);
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => ({}));
  const parsed = DispatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message, code: "INVALID" }, { status: 400 });
  }

  const task = await addDispatchedTask(tripId, {
    text: parsed.data.text,
    messageId: parsed.data.messageId ?? null,
    createdBy: auth.appUserId,
  });
  return NextResponse.json<DispatchTaskResponse>({ task });
}

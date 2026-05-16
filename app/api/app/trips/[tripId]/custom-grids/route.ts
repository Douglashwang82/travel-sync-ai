import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/db";
import { requireAppTripAccess } from "@/lib/app-server";
import { getAgent } from "@/services/agents/registry";
import type { AgentAutonomy } from "@/services/agents/types";

const AutonomyEnum = z.enum(["propose_only", "auto_apply_with_undo", "auto_apply"]);

const CreateSchema = z.object({
  agentType: z.string().min(1).max(64),
  title: z.string().min(1).max(120),
  frequencyHours: z.number().int().min(1).max(24 * 7).optional(),
  autonomy: AutonomyEnum.optional(),
  config: z.record(z.string(), z.unknown()),
});

type RouteContext = { params: Promise<{ tripId: string }> };

export interface CustomGrid {
  id: string;
  tripId: string;
  agentType: string;
  title: string;
  config: unknown;
  isActive: boolean;
  frequencyHours: number;
  autonomy: AgentAutonomy;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastStatus: "pending" | "running" | "success" | "failed" | null;
  lastOutput: Record<string, unknown> | null;
  lastError: string | null;
  createdAt: string;
}

function rowToGrid(row: Record<string, unknown>): CustomGrid {
  return {
    id: row.id as string,
    tripId: row.trip_id as string,
    agentType: row.agent_type as string,
    title: row.title as string,
    config: row.config,
    isActive: row.is_active as boolean,
    frequencyHours: row.frequency_hours as number,
    autonomy: ((row.autonomy as AgentAutonomy | null) ?? "propose_only"),
    nextRunAt: (row.next_run_at as string | null) ?? null,
    lastRunAt: (row.last_run_at as string | null) ?? null,
    lastStatus: (row.last_status as CustomGrid["lastStatus"]) ?? null,
    lastOutput: (row.last_output as Record<string, unknown> | null) ?? null,
    lastError: (row.last_error as string | null) ?? null,
    createdAt: row.created_at as string,
  };
}

/** GET /api/app/trips/:tripId/custom-grids — list grids for the trip. */
export async function GET(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const { tripId } = await ctx.params;
  const auth = await requireAppTripAccess(req, tripId);
  if (!auth.ok) return auth.response;

  const db = createAdminClient();
  const { data, error } = await db
    .from("custom_grids")
    .select(
      "id, trip_id, agent_type, title, config, is_active, frequency_hours, autonomy, next_run_at, last_run_at, last_status, last_output, last_error, created_at",
    )
    .eq("trip_id", tripId)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json(
      { error: "Failed to load custom grids", code: "DB_ERROR" },
      { status: 500 },
    );
  }

  return NextResponse.json({ grids: (data ?? []).map(rowToGrid) });
}

/** POST /api/app/trips/:tripId/custom-grids — create a new custom grid. */
export async function POST(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const { tripId } = await ctx.params;
  const auth = await requireAppTripAccess(req, tripId);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON", code: "INVALID_JSON" }, { status: 400 });
  }

  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const agent = getAgent(parsed.data.agentType);
  if (!agent) {
    return NextResponse.json(
      { error: `Unknown agent: ${parsed.data.agentType}`, code: "UNKNOWN_AGENT" },
      { status: 400 },
    );
  }

  const configParsed = agent.configSchema.safeParse(parsed.data.config);
  if (!configParsed.success) {
    return NextResponse.json(
      {
        error: "Agent config validation failed",
        code: "CONFIG_VALIDATION_ERROR",
        details: configParsed.error.flatten(),
      },
      { status: 400 },
    );
  }

  const db = createAdminClient();
  const { data, error } = await db
    .from("custom_grids")
    .insert({
      trip_id: tripId,
      created_by: auth.appUserId,
      agent_type: parsed.data.agentType,
      title: parsed.data.title,
      config: configParsed.data,
      frequency_hours: parsed.data.frequencyHours ?? agent.defaultFrequencyHours,
      autonomy: parsed.data.autonomy ?? "propose_only",
      next_run_at: new Date().toISOString(),
    })
    .select(
      "id, trip_id, agent_type, title, config, is_active, frequency_hours, autonomy, next_run_at, last_run_at, last_status, last_output, last_error, created_at",
    )
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: "Failed to create grid", code: "DB_ERROR" },
      { status: 500 },
    );
  }

  return NextResponse.json({ grid: rowToGrid(data) }, { status: 201 });
}

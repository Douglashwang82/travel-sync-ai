/**
 * Model Context Protocol (MCP) server.
 *
 * Exposes the orchestrator's tool registry to external MCP clients (Claude
 * Desktop, ChatGPT, Cursor, IDE plugins). The same Zod-typed tools the
 * in-process orchestrator uses are exposed over JSON-RPC 2.0 here.
 *
 * Protocol: stateless HTTP transport (one POST = one JSON-RPC request).
 * Methods implemented: `initialize`, `tools/list`, `tools/call`.
 *
 * Auth: bearer token in `Authorization: Bearer <token>` header. The token
 * encodes `{ tripId, lineUserId, exp }` and is signed with `MCP_SIGNING_SECRET`
 * (HS256). Mint tokens from the /app workspace once trip ownership is verified
 * — see app/api/app/mcp/token/route.ts (TODO: not yet implemented).
 *
 * Autonomy enforcement: tool calls go through the same persistAction path as
 * the orchestrator runner. propose_only tools write a pending proposal that
 * the group reviews in /app; auto_apply* tools execute immediately. Clients
 * see {mode: 'proposed'|'applied'|'auto_applied', actionId, ...} and can
 * poll for proposal resolution via tools/list refresh.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createHmac, timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/db";
import { captureError } from "@/lib/monitoring";
import { listTools, getTool } from "@/services/orchestrator/tools";
import type { ToolContext } from "@/services/orchestrator/types";

export const runtime = "nodejs";

// ─── JSON-RPC envelope ───────────────────────────────────────────────────────

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

function rpcResult(id: JsonRpcRequest["id"], result: unknown) {
  return NextResponse.json({ jsonrpc: "2.0", id, result });
}
function rpcError(id: JsonRpcRequest["id"], code: number, message: string, status = 200) {
  return NextResponse.json(
    { jsonrpc: "2.0", id, error: { code, message } },
    { status },
  );
}

// ─── Auth ────────────────────────────────────────────────────────────────────

interface McpAuth {
  tripId: string;
  lineUserId: string;
}

function verifyToken(token: string): McpAuth | null {
  const secret = process.env.MCP_SIGNING_SECRET;
  if (!secret) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, sigB64] = parts as [string, string];
  const expected = createHmac("sha256", secret).update(payloadB64).digest("base64url");
  const a = Buffer.from(sigB64);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as {
      tripId?: string;
      lineUserId?: string;
      exp?: number;
    };
    if (!payload.tripId || !payload.lineUserId) return null;
    if (payload.exp && payload.exp * 1000 < Date.now()) return null;
    return { tripId: payload.tripId, lineUserId: payload.lineUserId };
  } catch {
    return null;
  }
}

async function requireAuth(req: NextRequest): Promise<McpAuth | NextResponse> {
  const header = req.headers.get("authorization");
  const m = header?.match(/^Bearer\s+(.+)$/i);
  if (!m) return NextResponse.json({ error: "missing bearer token" }, { status: 401 });
  const auth = verifyToken(m[1]!);
  if (!auth) return NextResponse.json({ error: "invalid token" }, { status: 401 });

  // Confirm the bound LINE user is still a member of the trip's group.
  const db = createAdminClient();
  const { data: trip } = await db.from("trips").select("group_id").eq("id", auth.tripId).single();
  if (!trip) return NextResponse.json({ error: "trip not found" }, { status: 404 });
  const { data: membership } = await db
    .from("group_members")
    .select("id")
    .eq("group_id", trip.group_id)
    .eq("line_user_id", auth.lineUserId)
    .is("left_at", null)
    .maybeSingle();
  if (!membership) return NextResponse.json({ error: "not a trip member" }, { status: 403 });

  return auth;
}

// ─── persistAction (mirror of the orchestrator runner) ───────────────────────

async function persistMcpAction(input: {
  ctx: ToolContext;
  tool: string;
  args: Record<string, unknown>;
  status: "pending" | "applied" | "auto_applied" | "failed";
  summary: string;
  result?: Record<string, unknown> | null;
  target?: { table: string; id: string; op: "insert" | "update" | "delete"; before?: Record<string, unknown> | null } | null;
  autonomy: string;
}): Promise<string> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("orchestrator_actions")
    .insert({
      orchestrator_id: input.ctx.orchestratorId,
      trip_id: input.ctx.tripId,
      tool: input.tool,
      input: input.args,
      result: input.result ?? null,
      rationale: input.summary,
      status: input.status,
      autonomy: input.autonomy,
      target: input.target ?? null,
    })
    .select("id")
    .single();
  if (error || !data) {
    captureError(error ?? new Error("MCP persistAction failed"), { context: "mcp_persist", tool: input.tool });
    return "";
  }
  return data.id as string;
}

// ─── Method handlers ─────────────────────────────────────────────────────────

function handleInitialize(id: JsonRpcRequest["id"]) {
  return rpcResult(id, {
    protocolVersion: "2025-03-26",
    capabilities: { tools: { listChanged: false } },
    serverInfo: { name: "travel-sync-ai", version: "0.1.0" },
  });
}

function handleToolsList(id: JsonRpcRequest["id"]) {
  return rpcResult(id, {
    tools: listTools().map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: z.toJSONSchema(t.args),
    })),
  });
}

const ToolCallParams = z.object({
  name: z.string(),
  arguments: z.record(z.string(), z.unknown()).optional(),
});

async function handleToolsCall(id: JsonRpcRequest["id"], params: unknown, auth: McpAuth) {
  const parsed = ToolCallParams.safeParse(params);
  if (!parsed.success) return rpcError(id, -32602, "invalid params");

  const tool = getTool(parsed.data.name);
  if (!tool) return rpcError(id, -32601, `unknown tool: ${parsed.data.name}`);

  const argsParsed = tool.args.safeParse(parsed.data.arguments ?? {});
  if (!argsParsed.success) return rpcError(id, -32602, `invalid arguments: ${argsParsed.error.message}`);

  // Look up the trip's orchestrator so actions are linked to the same row
  // the in-process orchestrator would write to.
  const db = createAdminClient();
  const { data: orch } = await db
    .from("trip_orchestrators")
    .select("id, tool_autonomy")
    .eq("trip_id", auth.tripId)
    .maybeSingle();
  if (!orch) return rpcError(id, -32000, "trip has no orchestrator configured");

  const autonomy =
    ((orch.tool_autonomy as Record<string, string> | null)?.[tool.name] as string | undefined) ??
    tool.defaultAutonomy;
  const ctx: ToolContext = {
    tripId: auth.tripId,
    orchestratorId: orch.id as string,
    actorKey: `mcp:${auth.lineUserId}`,
  };
  const argsJson = JSON.parse(JSON.stringify(argsParsed.data)) as Record<string, unknown>;

  if (autonomy === "propose_only") {
    const preview = tool.dryDescribe(argsParsed.data);
    const actionId = await persistMcpAction({
      ctx, tool: tool.name, args: argsJson, status: "pending", summary: preview, autonomy,
    });
    return rpcResult(id, {
      content: [{ type: "text", text: `Proposed: ${preview}` }],
      structuredContent: { mode: "proposed", actionId, preview },
    });
  }

  try {
    const result = await tool.execute(ctx, argsParsed.data);
    const status = autonomy === "auto_apply" ? "auto_applied" : "applied";
    const actionId = await persistMcpAction({
      ctx, tool: tool.name, args: argsJson, status, summary: result.summary,
      result: result.data ?? null, target: result.target ?? null, autonomy,
    });
    return rpcResult(id, {
      content: [{ type: "text", text: result.summary }],
      structuredContent: { mode: status, actionId, result: result.data ?? null },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await persistMcpAction({
      ctx, tool: tool.name, args: argsJson, status: "failed", summary: `Failed: ${msg}`, autonomy,
    });
    return rpcError(id, -32000, msg);
  }
}

// ─── Route ───────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (authResult instanceof NextResponse) return authResult;
  const auth = authResult;

  let body: JsonRpcRequest;
  try {
    body = (await req.json()) as JsonRpcRequest;
  } catch {
    return rpcError(null, -32700, "parse error");
  }
  if (body.jsonrpc !== "2.0" || typeof body.method !== "string") {
    return rpcError(body.id ?? null, -32600, "invalid request");
  }

  switch (body.method) {
    case "initialize":
      return handleInitialize(body.id);
    case "tools/list":
      return handleToolsList(body.id);
    case "tools/call":
      return handleToolsCall(body.id, body.params, auth);
    default:
      return rpcError(body.id, -32601, `method not found: ${body.method}`);
  }
}

export async function GET() {
  return NextResponse.json({
    name: "travel-sync-ai",
    transport: "http",
    protocol: "2025-03-26",
    hint: "POST JSON-RPC 2.0 requests. Auth: Bearer <token>. Mint tokens from /app once you've authenticated.",
  });
}

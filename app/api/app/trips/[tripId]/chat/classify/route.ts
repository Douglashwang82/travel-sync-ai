import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/db";
import { requireAppTripAccess } from "@/lib/app-server";
import { publicAgents, getAgent } from "@/services/agents/registry";
import { completeJson, LlmUnavailableError, LlmSchemaError } from "@/lib/llm";

type RouteContext = { params: Promise<{ tripId: string }> };

/**
 * The verdict for a single chat message: can one of the trip's AI agents turn
 * it into a recurring bento grid, and if so which one + with what config.
 * `config` is best-effort — required fields the model couldn't derive are
 * omitted, and the caller completes them in the Add-grid dialog.
 */
export interface ChatTaskClassification {
  workable: boolean;
  agentType: string | null;
  title: string;
  config: Record<string, unknown>;
  confidence: number;
  reason: string;
}

const InputSchema = z.object({
  messageId: z.string().uuid(),
});

// What the model must return. Kept loose (config is free-form) so partial
// extractions still parse; we re-validate agentType against the registry below.
const ModelSchema = z.object({
  workable: z.boolean(),
  agentType: z.string().nullable(),
  title: z.string().max(120).default(""),
  config: z.record(z.string(), z.unknown()).default({}),
  confidence: z.number().min(0).max(1).default(0),
  reason: z.string().max(400).default(""),
});

const MIN_CONFIDENCE = 0.5;

function buildAgentCatalog(): string {
  return publicAgents()
    .map((a) => {
      const fields = a.configFields
        .map((f) => `${f.name}${"required" in f && f.required ? "*" : ""}:${f.type}`)
        .join(", ");
      return `- ${a.type} — ${a.label}: ${a.description} | config fields: ${fields || "none"}`;
    })
    .join("\n");
}

/**
 * POST /api/app/trips/:tripId/chat/classify
 *
 * Decides whether a single group-chat message is an "agent-workable" task —
 * an ongoing, trackable need one of the trip's AI agents can own as a bento
 * grid — and, if so, which agent and a best-effort config drawn from the
 * message plus trip context. Used by the chat to decide if a bubble can be
 * dragged onto the grids rail.
 */
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

  const parsed = InputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const db = createAdminClient();

  // Fetch the message, asserting it belongs to *this* trip's group room.
  const { data: msg } = await db
    .from("trip_chat_messages")
    .select("content, thread:trip_chat_threads!inner(trip_id, kind)")
    .eq("id", parsed.data.messageId)
    .eq("thread.trip_id", tripId)
    .eq("thread.kind", "group")
    .maybeSingle();

  if (!msg) {
    return NextResponse.json(
      { error: "Message not found in this trip's chat", code: "NOT_FOUND" },
      { status: 404 },
    );
  }

  const content = (msg.content as string | null)?.trim() ?? "";
  if (content.length < 3) {
    return NextResponse.json({
      classification: emptyVerdict("Message too short to act on."),
    });
  }

  const { data: trip } = await db
    .from("trips")
    .select("destination_name, start_date, end_date")
    .eq("id", tripId)
    .maybeSingle();

  const tripContext = [
    `Destination: ${trip?.destination_name ?? "unknown"}`,
    `Dates: ${trip?.start_date ?? "?"} → ${trip?.end_date ?? "?"}`,
  ].join("\n");

  const systemPrompt = [
    "You classify a single travel group-chat message. Decide whether it describes an ongoing, trackable need that ONE of the agents below can own as a recurring bento grid (e.g. wanting to watch flight or hotel prices, check weather for the trip, gather destination photos, or read group consensus).",
    "",
    "Agents (config fields marked * are required):",
    buildAgentCatalog(),
    "",
    "Trip context:",
    tripContext,
    "",
    "Rules:",
    "- workable=true ONLY if the message clearly maps to one agent and is a recurring/trackable need, not casual chatter.",
    "- Pick the single best agentType from the list above (exact type string), else null.",
    "- title: a short grid title (<= 6 words) in the message's language.",
    "- config: fill required fields you can confidently derive from the message + trip context; OMIT any you cannot (do not guess flight origins, exact dates, etc.).",
    "- confidence: 0..1 self-estimate.",
    "- reason: one short sentence.",
    'Respond as JSON: {"workable":bool,"agentType":string|null,"title":string,"config":object,"confidence":number,"reason":string}',
  ].join("\n");

  let verdict: z.infer<typeof ModelSchema>;
  try {
    verdict = await completeJson(`Message:\n"""${content}"""`, {
      schema: ModelSchema,
      taskClass: "extractor",
      systemPrompt,
      tripId,
      metadata: { feature: "chat_task_classify", messageId: parsed.data.messageId },
    });
  } catch (err) {
    if (err instanceof LlmUnavailableError || err instanceof LlmSchemaError) {
      // Don't fail the bubble — just say "not draggable" for now.
      return NextResponse.json({ classification: emptyVerdict("Classifier unavailable.") });
    }
    throw err;
  }

  // Re-validate the model's pick against the real registry + threshold.
  const agent = verdict.agentType ? getAgent(verdict.agentType) : null;
  const workable = verdict.workable && !!agent && verdict.confidence >= MIN_CONFIDENCE;

  const classification: ChatTaskClassification = {
    workable,
    agentType: workable ? agent!.type : null,
    title: verdict.title?.trim() || agent?.label || "",
    config: workable ? verdict.config : {},
    confidence: verdict.confidence,
    reason: verdict.reason,
  };

  return NextResponse.json({ classification });
}

function emptyVerdict(reason: string): ChatTaskClassification {
  return { workable: false, agentType: null, title: "", config: {}, confidence: 0, reason };
}

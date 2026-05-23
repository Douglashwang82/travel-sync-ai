/**
 * Server-Sent Events endpoint for streaming chat replies to the /app web UI.
 *
 * Mirrors the LINE private-chat flow (services/private-chat) but streams
 * tokens to the browser instead of buffering a single reply. LINE itself
 * cannot stream, so this is /app-only.
 *
 * Request: POST /api/app/chat/stream  { tripId: string, message: string }
 * Response: text/event-stream
 *   event: token   data: "<text chunk>"
 *   event: done    data: "{\"finishReason\":\"stop\"}"
 *   event: error   data: "{\"message\":\"...\"}"
 *
 * Auth: cookie session (requireAppUser). User must be a member of the trip's group.
 *
 * The Gemini SDK exposes streaming via `generateContentStream`. For Anthropic
 * we use the `stream: true` flag on messages.create. Both yield text deltas
 * that we forward as SSE `token` events.
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { GoogleGenAI } from "@google/genai";
import Anthropic from "@anthropic-ai/sdk";
import { createAdminClient } from "@/lib/db";
import { readAppSessionCookieFromRequest } from "@/lib/app-server";
import { loadPrompt, renderPrompt } from "@/lib/prompts";
import { recordLlmCall } from "@/lib/llm-telemetry";
import { getModel } from "@/lib/gemini";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  tripId: z.string().uuid(),
  message: z.string().min(1).max(2000),
});

function sseChunk(event: string, data: string): Uint8Array {
  return new TextEncoder().encode(`event: ${event}\ndata: ${data}\n\n`);
}

export async function POST(req: NextRequest) {
  const lineUserId = await readAppSessionCookieFromRequest(req);
  if (!lineUserId) {
    return new Response("unauthorized", { status: 401 });
  }

  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(await req.json());
  } catch (err) {
    return new Response(`invalid body: ${err instanceof Error ? err.message : String(err)}`, { status: 400 });
  }

  const db = createAdminClient();
  const { data: trip } = await db
    .from("trips")
    .select("id, destination_name, start_date, end_date, status, group_id")
    .eq("id", parsed.tripId)
    .single();
  if (!trip) return new Response("trip not found", { status: 404 });

  const { data: membership } = await db
    .from("group_members")
    .select("id")
    .eq("group_id", trip.group_id)
    .eq("line_user_id", lineUserId)
    .is("left_at", null)
    .maybeSingle();
  if (!membership) return new Response("not a member of this trip", { status: 403 });

  const { data: group } = await db
    .from("line_groups")
    .select("name")
    .eq("id", trip.group_id)
    .single();

  const prompt = loadPrompt("private_chat.system");
  const tripContext = trip
    ? `Trip: ${trip.destination_name ?? "(unset)"} (${trip.start_date ?? "?"} → ${trip.end_date ?? "?"}, status ${trip.status})`
    : "(no active trip)";
  const system = renderPrompt(prompt, {
    group_name: group?.name ?? "(unnamed group)",
    trip_context: tripContext,
  });

  const provider = process.env.LLM_PROVIDER_PRIVATE_CHAT === "anthropic" ? "anthropic" : "gemini";
  const started = Date.now();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        if (provider === "anthropic") {
          const model = process.env.ANTHROPIC_MODEL?.trim() || "claude-sonnet-4-6";
          const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
          const resp = await client.messages.stream({
            model,
            max_tokens: 1024,
            system,
            messages: [{ role: "user", content: parsed.message }],
          });
          for await (const event of resp) {
            if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
              controller.enqueue(sseChunk("token", JSON.stringify(event.delta.text)));
            }
          }
          const final = await resp.finalMessage();
          await recordLlmCall({
            provider: "anthropic",
            model,
            taskClass: "private_chat",
            promptId: prompt.id,
            promptHash: prompt.hash,
            tokensIn: final.usage?.input_tokens,
            tokensOut: final.usage?.output_tokens,
            latencyMs: Date.now() - started,
            status: "ok",
            tripId: parsed.tripId,
          });
        } else {
          const model = getModel();
          const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
          const resp = await client.models.generateContentStream({
            model,
            contents: [{ role: "user", parts: [{ text: parsed.message }] }],
            config: { systemInstruction: system },
          });
          let inTokens = 0;
          let outTokens = 0;
          for await (const chunk of resp) {
            const text = chunk.text;
            if (text) controller.enqueue(sseChunk("token", JSON.stringify(text)));
            const usage = (chunk as { usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } }).usageMetadata;
            if (usage?.promptTokenCount) inTokens = usage.promptTokenCount;
            if (usage?.candidatesTokenCount) outTokens = usage.candidatesTokenCount;
          }
          await recordLlmCall({
            provider: "gemini",
            model,
            taskClass: "private_chat",
            promptId: prompt.id,
            promptHash: prompt.hash,
            tokensIn: inTokens || undefined,
            tokensOut: outTokens || undefined,
            latencyMs: Date.now() - started,
            status: "ok",
            tripId: parsed.tripId,
          });
        }
        controller.enqueue(sseChunk("done", JSON.stringify({ finishReason: "stop" })));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        controller.enqueue(sseChunk("error", JSON.stringify({ message: msg })));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}

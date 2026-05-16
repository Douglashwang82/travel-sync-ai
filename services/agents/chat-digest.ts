import { z } from "zod";
import { createAdminClient } from "@/lib/db";
import { generateJson, GeminiUnavailableError } from "@/lib/gemini";
import type { AgentDefinition, AgentRunContext, AgentRunResult } from "./types";

const ConfigSchema = z.object({
  windowHours: z.number().int().min(1).max(24 * 14).default(24 * 7),
  maxMessages: z.number().int().min(10).max(500).default(120),
});

type DigestConfig = z.infer<typeof ConfigSchema>;

interface ChatMessage {
  user: string;
  text: string;
  at: string;
}

const DigestResultSchema = z.object({
  summary: z.string(),
  decisions: z.array(z.string()).default([]),
  openQuestions: z.array(z.string()).default([]),
});

type DigestResult = z.infer<typeof DigestResultSchema>;

/**
 * Resolve the LINE group bound to this trip, then pull recent messages
 * across the configured window. Returns `null` if the trip has no group
 * (web-only trip) or no messages in window.
 */
async function loadChat(
  tripId: string,
  config: DigestConfig,
): Promise<{ groupId: string | null; messages: ChatMessage[] }> {
  const db = createAdminClient();

  const { data: trip } = await db
    .from("trips")
    .select("group_id")
    .eq("id", tripId)
    .single();

  if (!trip?.group_id) return { groupId: null, messages: [] };

  const since = new Date(Date.now() - config.windowHours * 60 * 60 * 1000).toISOString();
  const { data: rows } = await db
    .from("raw_messages")
    .select("message_text, line_user_id, created_at")
    .eq("group_id", trip.group_id)
    .gte("created_at", since)
    .order("created_at", { ascending: true })
    .limit(config.maxMessages);

  const messages: ChatMessage[] = (rows ?? []).map((r) => ({
    user: (r.line_user_id as string).slice(-4),  // short suffix; we don't want to leak full IDs into prompts
    text: r.message_text as string,
    at: r.created_at as string,
  }));

  return { groupId: trip.group_id as string, messages };
}

function fallbackSummary(messages: ChatMessage[]): DigestResult {
  if (messages.length === 0) {
    return { summary: "No chat activity in the window.", decisions: [], openQuestions: [] };
  }
  const senders = new Set(messages.map((m) => m.user)).size;
  return {
    summary: `${messages.length} messages from ${senders} people. Open the trip's LINE group for details.`,
    decisions: [],
    openQuestions: [],
  };
}

async function summarizeWithLLM(messages: ChatMessage[]): Promise<DigestResult> {
  const transcript = messages
    .map((m) => `[${m.at.slice(11, 16)}] u${m.user}: ${m.text}`)
    .join("\n")
    .slice(0, 8_000);

  try {
    const raw = await generateJson<unknown>(
      [
        "You are summarizing a trip-planning chat for travelers who missed the conversation.",
        "Produce JSON with three fields:",
        "  summary: 2-3 sentences in plain English. Mention concrete topics (destinations, dates, hotels).",
        "  decisions: array of strings, each describing one thing the group seems to have settled on (max 5).",
        "  openQuestions: array of strings of still-unresolved items (max 5).",
        "Skip greetings and small talk. Never invent facts.",
        "Respond with strict JSON only.",
      ].join("\n"),
      transcript,
    );
    const parsed = DigestResultSchema.safeParse(raw);
    if (parsed.success) return parsed.data;
    return fallbackSummary(messages);
  } catch (err) {
    if (err instanceof GeminiUnavailableError) return fallbackSummary(messages);
    throw err;
  }
}

async function run(ctx: AgentRunContext): Promise<AgentRunResult> {
  const config = ConfigSchema.parse(ctx.config);
  const { groupId, messages } = await loadChat(ctx.tripId, config);

  if (!groupId) {
    return {
      outputKind: "summary",
      output: {
        summary: "This trip isn't linked to a LINE group, so there's no chat to digest.",
        decisions: [],
        openQuestions: [],
        messageCount: 0,
        sinceLabel: formatWindow(config.windowHours),
        checkedAt: new Date().toISOString(),
      },
    };
  }

  const digest = messages.length === 0 ? fallbackSummary(messages) : await summarizeWithLLM(messages);

  return {
    outputKind: "summary",
    output: {
      summary: digest.summary,
      decisions: digest.decisions,
      openQuestions: digest.openQuestions,
      messageCount: messages.length,
      sinceLabel: formatWindow(config.windowHours),
      checkedAt: new Date().toISOString(),
    },
  };
}

function formatWindow(hours: number): string {
  if (hours < 24) return `Last ${hours}h`;
  const days = Math.round(hours / 24);
  return `Last ${days}d`;
}

export const chatDigest: AgentDefinition<DigestConfig> = {
  type: "chat_digest",
  label: "Chat digest",
  description:
    "Summarizes recent LINE group chat into decisions and open questions. Great for catching up.",
  icon: "💬",
  mode: "assist",
  defaultFrequencyHours: 24,
  configSchema: ConfigSchema,
  defaultConfig: { windowHours: 24 * 7, maxMessages: 120 },
  configFields: [
    {
      name: "windowHours",
      label: "Window (hours)",
      type: "number",
      placeholder: "168",
      min: 1,
      max: 24 * 14,
    },
    {
      name: "maxMessages",
      label: "Max messages",
      type: "number",
      placeholder: "120",
      min: 10,
      max: 500,
    },
  ],
  run,
};

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
    return { summary: "這段時間內群組沒有任何聊天紀錄。", decisions: [], openQuestions: [] };
  }
  const senders = new Set(messages.map((m) => m.user)).size;
  return {
    summary: `${senders} 位成員共留下 ${messages.length} 則訊息。請開啟此旅程的 LINE 群組查看詳情。`,
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
        "你正在為錯過群組討論的旅伴整理一份旅程規劃的聊天摘要。",
        "請輸出包含三個欄位的 JSON:",
        "  summary: 2-3 句繁體中文摘要,點出實際討論的主題(目的地、日期、飯店等)。",
        "  decisions: 字串陣列,每一條描述群組似乎已經決定的事項(最多 5 條,繁體中文)。",
        "  openQuestions: 字串陣列,描述仍未決定的議題(最多 5 條,繁體中文)。",
        "請略過寒暄與閒聊,不可捏造事實。",
        "僅以嚴格 JSON 格式回覆。",
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
        summary: "這個旅程尚未綁定 LINE 群組,因此沒有聊天內容可整理。",
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
  if (hours < 24) return `近 ${hours} 小時`;
  const days = Math.round(hours / 24);
  return `近 ${days} 天`;
}

export const chatDigest: AgentDefinition<DigestConfig> = {
  type: "chat_digest",
  label: "聊天摘要",
  description:
    "把近期的 LINE 群組討論整理成決議與待解問題,讓錯過的人能快速跟上。",
  icon: "💬",
  mode: "assist",
  defaultFrequencyHours: 24,
  configSchema: ConfigSchema,
  defaultConfig: { windowHours: 24 * 7, maxMessages: 120 },
  configFields: [
    {
      name: "windowHours",
      label: "時間範圍(小時)",
      type: "number",
      placeholder: "168",
      min: 1,
      max: 24 * 14,
    },
    {
      name: "maxMessages",
      label: "訊息數上限",
      type: "number",
      placeholder: "120",
      min: 10,
      max: 500,
    },
  ],
  run,
};

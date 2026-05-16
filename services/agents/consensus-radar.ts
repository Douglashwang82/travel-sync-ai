import { z } from "zod";
import { createAdminClient } from "@/lib/db";
import { generateJson, GeminiUnavailableError } from "@/lib/gemini";
import type { AgentDefinition, AgentRunContext, AgentRunResult } from "./types";

const ConfigSchema = z.object({
  /** Only flag candidates where the LLM is at least this confident (0–1). */
  minConfidence: z.number().min(0).max(1).default(0.6),
  windowHours: z.number().int().min(1).max(24 * 14).default(24 * 3),
  maxMessages: z.number().int().min(10).max(300).default(80),
});

type RadarConfig = z.infer<typeof ConfigSchema>;

interface Candidate {
  topic: string;
  leaningOption: string;
  confidence: number;
  /** A short rationale; safe to show in the tile. */
  rationale: string;
}

const ResultSchema = z.object({
  candidates: z.array(
    z.object({
      topic: z.string().min(1).max(120),
      leaningOption: z.string().min(1).max(120),
      confidence: z.number().min(0).max(1),
      rationale: z.string().min(1).max(280),
    }),
  ).max(6),
});

interface ChatLine {
  user: string;
  text: string;
  at: string;
}

/**
 * Pull a recent chat sample for the trip. We prefer the most recent N lines
 * directly from `raw_messages` rather than asking the chat_digest tile, so
 * we always have fresh signal even if no digest has been generated yet.
 * But we *also* peek at the digest's open questions to bias the LLM.
 */
async function loadChat(
  tripId: string,
  config: RadarConfig,
): Promise<{ groupId: string | null; messages: ChatLine[] }> {
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

  const messages: ChatLine[] = (rows ?? []).map((r) => ({
    user: (r.line_user_id as string).slice(-4),
    text: r.message_text as string,
    at: r.created_at as string,
  }));
  return { groupId: trip.group_id as string, messages };
}

async function detect(
  messages: ChatLine[],
  digestOpenQuestions: string[],
): Promise<Candidate[]> {
  if (messages.length === 0) return [];

  const transcript = messages
    .map((m) => `[${m.at.slice(11, 16)}] u${m.user}: ${m.text}`)
    .join("\n")
    .slice(0, 8_000);

  try {
    const raw = await generateJson<unknown>(
      [
        "你正在掃描一段旅程規劃的聊天紀錄,尋找「軟共識」——也就是群組似乎已經偏向某個選項,但還沒有人正式提議投票的議題。",
        digestOpenQuestions.length > 0
          ? `來自聊天摘要代理的已知未決議題:${JSON.stringify(digestOpenQuestions)}。`
          : "",
        "請輸出嚴格 JSON:{ candidates: [{ topic: string, leaningOption: string, confidence: 0..1, rationale: string }] }。",
        "所有顯示文字(topic、leaningOption、rationale)請使用繁體中文。",
        "請略過反問與閒聊。信心值高於 0.7 代表明顯偏好;低於 0.4 為微弱訊號,請省略。",
        "不可捏造聊天中不存在的事實。最多回傳 6 條候選。",
      ]
        .filter(Boolean)
        .join("\n"),
      transcript,
    );
    const parsed = ResultSchema.safeParse(raw);
    return parsed.success ? parsed.data.candidates : [];
  } catch (err) {
    if (err instanceof GeminiUnavailableError) return [];
    throw err;
  }
}

async function run(ctx: AgentRunContext): Promise<AgentRunResult> {
  const config = ConfigSchema.parse(ctx.config);

  const digestOutput = await ctx.getOutputOf("chat_digest");
  const digestOpenQuestions = ((digestOutput?.openQuestions as string[] | undefined) ?? []).slice(0, 5);

  const { groupId, messages } = await loadChat(ctx.tripId, config);
  if (!groupId) {
    return {
      outputKind: "list",
      output: {
        summary: "這個旅程尚未綁定 LINE 群組,沒有聊天可掃描。",
        candidates: [],
        usedDigest: digestOutput !== null,
        checkedAt: new Date().toISOString(),
      },
    };
  }

  const raw = await detect(messages, digestOpenQuestions);
  const candidates = raw.filter((c) => c.confidence >= config.minConfidence);

  const summary =
    candidates.length === 0
      ? `已掃描 ${messages.length} 則訊息,目前尚未發現明顯共識。`
      : `發現 ${candidates.length} 個議題群組似乎已有偏好,建議用 /vote 正式確認。`;

  return {
    outputKind: "list",
    output: {
      summary,
      candidates,
      messageCount: messages.length,
      usedDigest: digestOutput !== null,
      checkedAt: new Date().toISOString(),
    },
  };
}

export const consensusRadar: AgentDefinition<RadarConfig> = {
  type: "consensus_radar",
  label: "共識雷達",
  description:
    "掃描近期聊天,找出群組似乎已經傾向、但尚未正式投票的議題。若有「聊天摘要」格子也會一併參考。",
  icon: "🎯",
  mode: "assist",
  defaultFrequencyHours: 24,
  dependsOn: ["chat_digest"],
  configSchema: ConfigSchema,
  defaultConfig: { minConfidence: 0.6, windowHours: 72, maxMessages: 80 },
  configFields: [
    {
      name: "minConfidence",
      label: "最低信心值(0–1)",
      type: "number",
      placeholder: "0.6",
      min: 0,
      max: 1,
    },
    {
      name: "windowHours",
      label: "時間範圍(小時)",
      type: "number",
      placeholder: "72",
      min: 1,
      max: 24 * 14,
    },
    {
      name: "maxMessages",
      label: "訊息數上限",
      type: "number",
      placeholder: "80",
      min: 10,
      max: 300,
    },
  ],
  run,
};

import { z } from "zod";
import { createAdminClient } from "@/lib/db";
import { generateJson, GeminiUnavailableError } from "@/lib/gemini";
import { createItem } from "@/services/trip-state";
import { pushAgentAck } from "@/services/notifications/agent-ack";
import type { AgentDefinition, AgentRunContext, AgentRunResult } from "./types";

const ConfigSchema = z.object({
  destination: z.string().min(2).max(120),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  days: z.number().int().min(1).max(14).default(3),
  vibe: z.enum(["balanced", "foodie", "outdoors", "culture", "relaxed"]).default("balanced"),
});

type DrafterConfig = z.infer<typeof ConfigSchema>;

interface DraftedDay {
  date: string;
  title: string;
  suggestions: Array<{
    /** "activity" | "restaurant" | "hotel" — kept loose because Gemini sometimes invents categories. */
    category: string;
    text: string;
  }>;
}

const DraftSchema = z.object({
  overview: z.string(),
  days: z
    .array(
      z.object({
        date: z.string(),
        title: z.string(),
        suggestions: z.array(
          z.object({
            category: z.string(),
            text: z.string(),
          }),
        ),
      }),
    )
    .max(14),
});

function fallbackDraft(config: DrafterConfig): { overview: string; days: DraftedDay[] } {
  const start = new Date(config.startDate + "T00:00:00Z");
  return {
    overview: `${config.destination} 的 ${config.days} 天「${config.vibe}」風格行程草稿。目前無法連線到 Gemini,以下僅為佔位內容,請編輯後再正式採用。`,
    days: Array.from({ length: config.days }, (_, i) => {
      const d = new Date(start.getTime() + i * 86_400_000);
      return {
        date: d.toISOString().slice(0, 10),
        title: `${config.destination} 第 ${i + 1} 天`,
        suggestions: [
          { category: "activity", text: "早上:選一個街區散步" },
          { category: "restaurant", text: "午餐:當地特色料理" },
          { category: "activity", text: "下午:參觀一座博物館或公園" },
        ],
      };
    }),
  };
}

async function draftWithLLM(config: DrafterConfig): Promise<{ overview: string; days: DraftedDay[] }> {
  try {
    const raw = await generateJson<unknown>(
      [
        `你正在為 ${config.destination} 撰寫一份從 ${config.startDate} 開始、為期 ${config.days} 天的旅程草稿。`,
        `風格:${config.vibe}。`,
        "請輸出嚴格 JSON,結構為:{ overview: string, days: [{ date: 'YYYY-MM-DD', title: string, suggestions: [{ category: 'activity'|'restaurant'|'hotel', text: string }] }] }。",
        "所有文字內容(overview、title、suggestions.text)請使用繁體中文。",
        "建議內容要具體(指名街區或知名景點),每天 2-4 條建議。",
        "請勿杜撰機票或飯店訂位,也不要列出價格。",
        "僅以嚴格 JSON 格式回覆。",
      ].join("\n"),
      JSON.stringify({ destination: config.destination, startDate: config.startDate, days: config.days, vibe: config.vibe }),
    );
    const parsed = DraftSchema.safeParse(raw);
    if (!parsed.success) return fallbackDraft(config);
    return parsed.data;
  } catch (err) {
    if (err instanceof GeminiUnavailableError) return fallbackDraft(config);
    throw err;
  }
}

const AGENT_KEY = "itinerary_drafter";

/**
 * Each suggestion becomes a row in `trip_ideas` tagged with `source_agent`.
 * Ideas already have a "promote → trip_item" flow, which gives the human
 * the final say — exactly the propose-mode contract.
 *
 * We dedupe on (trip_id, text) so re-running doesn't create duplicates;
 * the agent's job is to *refresh* the lane, not pile onto it.
 */
async function persistAsIdeas(
  tripId: string,
  runId: string,
  config: DrafterConfig,
  days: DraftedDay[],
): Promise<{ created: number; skipped: number }> {
  const db = createAdminClient();

  const { data: trip } = await db
    .from("trips")
    .select("group_id")
    .eq("id", tripId)
    .single();
  if (!trip?.group_id) return { created: 0, skipped: 0 };

  const { data: existing } = await db
    .from("trip_ideas")
    .select("text")
    .eq("trip_id", tripId)
    .eq("source_agent", AGENT_KEY);
  const existingTexts = new Set((existing ?? []).map((r) => normalize(r.text as string)));

  type Row = {
    trip_id: string;
    group_id: string;
    submitted_by: string;
    display_name: string;
    category: string;
    text: string;
    source_agent: string;
    source_run_id: string;
    source_inputs: Record<string, unknown>;
  };
  const rows: Row[] = [];
  let skipped = 0;

  for (const day of days) {
    for (const s of day.suggestions) {
      const text = `${day.title}: ${s.text}`;
      if (existingTexts.has(normalize(text))) {
        skipped++;
        continue;
      }
      rows.push({
        trip_id: tripId,
        group_id: trip.group_id as string,
        submitted_by: `agent:${AGENT_KEY}`,
        display_name: "AI 行程規劃師",
        category: ideaCategoryFor(s.category),
        text,
        source_agent: AGENT_KEY,
        source_run_id: runId,
        source_inputs: { date: day.date, vibe: config.vibe, originalCategory: s.category },
      });
    }
  }

  if (rows.length === 0) return { created: 0, skipped };

  const { error } = await db.from("trip_ideas").insert(rows);
  if (error) {
    // Don't fail the agent run for a partial DB error; report counts honestly.
    return { created: 0, skipped: skipped + rows.length };
  }
  return { created: rows.length, skipped };
}

function ideaCategoryFor(raw: string): string {
  const v = raw.toLowerCase();
  if (v.includes("hotel") || v.includes("stay")) return "hotel";
  if (v.includes("food") || v.includes("restaurant") || v.includes("eat")) return "restaurant";
  if (v.includes("activity") || v.includes("see") || v.includes("visit")) return "activity";
  return "general";
}

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * When autonomy is `auto_apply_with_undo` or `auto_apply`, also promote each
 * fresh suggestion to a `trip_items` row tagged with provenance. Dismissing
 * the corresponding ghost card in the AI Updates tile is the undo path —
 * the item soft-disappears from the lane; a future API can hard-delete it.
 */
async function autoApplyToItems(
  tripId: string,
  runId: string,
  config: DrafterConfig,
  days: DraftedDay[],
): Promise<number> {
  let created = 0;
  for (const day of days) {
    for (const s of day.suggestions) {
      const itemType = itemTypeFor(s.category);
      const title = `${day.title}: ${s.text}`;
      const res = await createItem({
        tripId,
        title,
        itemType,
        source: "ai",
        sourceAgent: AGENT_KEY,
        sourceRunId: runId,
        sourceInputs: { date: day.date, vibe: config.vibe, originalCategory: s.category },
      });
      if (res.ok) created++;
    }
  }
  return created;
}

function itemTypeFor(raw: string): "activity" | "hotel" | "restaurant" | "other" {
  const v = raw.toLowerCase();
  if (v.includes("hotel") || v.includes("stay")) return "hotel";
  if (v.includes("restaurant") || v.includes("food") || v.includes("eat")) return "restaurant";
  if (v.includes("activity") || v.includes("see") || v.includes("visit")) return "activity";
  return "other";
}

async function run(ctx: AgentRunContext): Promise<AgentRunResult> {
  const config = ConfigSchema.parse(ctx.config);
  const draft = await draftWithLLM(config);
  const persisted = await persistAsIdeas(ctx.tripId, ctx.customGridId, config, draft.days);

  let itemsCreated = 0;
  if (ctx.autonomy !== "propose_only" && persisted.created > 0) {
    itemsCreated = await autoApplyToItems(ctx.tripId, ctx.customGridId, config, draft.days);
    if (itemsCreated > 0) {
      const msg = `🤖 行程規劃師為 ${config.destination} 在待辦看板新增了 ${itemsCreated} 個行程,請開啟 App 檢視。`;
      await pushAgentAck(ctx.tripId, msg);
    }
  } else if (persisted.created > 0 && ctx.autonomy === "propose_only") {
    // Even in propose_only mode, a one-line nudge to the group is useful so
    // members know to glance at Ideas. Keep this opt-out for the future if it
    // proves noisy.
    const msg = `✦ 行程規劃師為 ${config.destination} 在「點子」新增了 ${persisted.created} 條建議。`;
    await pushAgentAck(ctx.tripId, msg);
  }

  return {
    outputKind: "list",
    output: {
      destination: config.destination,
      startDate: config.startDate,
      days: draft.days,
      overview: draft.overview,
      created: persisted.created,
      skipped: persisted.skipped,
      itemsCreated,
      autonomy: ctx.autonomy,
      checkedAt: new Date().toISOString(),
    },
  };
}

export const itineraryDrafter: AgentDefinition<DrafterConfig> = {
  type: AGENT_KEY,
  label: "行程規劃師",
  description:
    "為目的地撰寫一份每日行程草稿,並把建議放進「點子」中,方便你編輯或正式採用。",
  icon: "🗺️",
  mode: "propose",
  defaultFrequencyHours: 24 * 7, // weekly refresh; users mostly run it on demand
  configSchema: ConfigSchema,
  defaultConfig: {
    destination: "",
    startDate: "",
    days: 3,
    vibe: "balanced",
  } as DrafterConfig,
  configFields: [
    { name: "destination", label: "目的地", type: "text", placeholder: "京都,日本", required: true },
    { name: "startDate", label: "開始日期", type: "date", required: true },
    { name: "days", label: "天數", type: "number", placeholder: "3", min: 1, max: 14 },
    {
      name: "vibe",
      label: "風格",
      type: "select",
      options: [
        { value: "balanced", label: "均衡" },
        { value: "foodie", label: "美食" },
        { value: "outdoors", label: "戶外" },
        { value: "culture", label: "文化" },
        { value: "relaxed", label: "悠閒" },
      ],
    },
  ],
  run,
};

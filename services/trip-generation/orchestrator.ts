// ─────────────────────────────────────────────────────────────────────────────
// Orchestrator — Tier 1 of the v1.2 itinerary generator.
//
// Drives the pipeline:
//
//   retrieve_pois  →  llm_pick_assignment  →  solve_route
//                                                 │
//                                                 ├─ feasible → persist → done
//                                                 │
//                                                 └─ infeasible → repair_loop
//                                                                 (≤2 retries)
//
// The LLM never sees opening hours or coordinates. It picks which K places go
// on which day; the solver enforces the logistics. On infeasibility the LLM
// gets a structured report ("Day 2 stop X opens at 10am, can't fit") and is
// asked to swap from the remaining shortlist.
//
// Not LangGraph: a plain typed state machine. We have ~5 nodes and a single
// loop; pulling in a framework here would cost more than it saves.
// ─────────────────────────────────────────────────────────────────────────────

import { randomBytes, createHash } from "node:crypto";
import { z } from "zod";
import { createAdminClient } from "@/lib/db";
import { generateJson, GeminiUnavailableError } from "@/lib/gemini";
import { searchPoisByVibe, enrichWithLiveData, type EnrichedPoi } from "./poi-engine";
import { solveItinerary, type RoutedDay, type InfeasibilityIssue } from "./solver";
import type { GenerateInput, GenerateOutput } from "./generator";

// ─── Errors ─────────────────────────────────────────────────────────────────

export type GenerationFailureReason =
  | "gemini_unavailable"
  | "schema_invalid"
  | "persist_failed"
  | "invalid_answers"
  | "no_candidates"
  | "irreparable";

export class GenerationFailedError extends Error {
  constructor(public reason: GenerationFailureReason, message?: string) {
    super(message ?? `Itinerary generation failed: ${reason}`);
    this.name = "GenerationFailedError";
  }
}

// ─── LLM pick schema ────────────────────────────────────────────────────────
// The LLM only emits assignments by placeId — no titles, no times, no notes.
// That keeps it impossible to hallucinate venues that don't exist in our
// shortlist.

const PickSchema = z.object({
  title: z.string().min(2).max(120),
  summary: z.string().min(10).max(800),
  tags: z.array(z.string()).max(8).default([]),
  days: z
    .array(
      z.object({
        day_number: z.number().int().min(1).max(30),
        place_ids: z.array(z.string()).max(8),
      })
    )
    .min(1)
    .max(30),
});
type PickResult = z.infer<typeof PickSchema>;

// ─── Public entry ───────────────────────────────────────────────────────────

const MAX_REPAIR_ATTEMPTS = 2;

export async function runGenerationPipeline(input: GenerateInput): Promise<GenerateOutput> {
  validateAnswers(input);

  // 1. Retrieve POIs (vector + live data)
  const candidates = await searchPoisByVibe({
    destination: input.answers.destination ?? "",
    vibe: input.answers.vibe,
    pace: input.answers.pace,
    budget: input.answers.budget_tier,
    k: 30,
  });
  if (candidates.length === 0) {
    throw new GenerationFailedError("no_candidates", "POI engine returned zero candidates");
  }
  const enriched = await enrichWithLiveData(candidates);

  // 2. LLM pick → 3. solve → 4. repair loop
  const startWeekday = deriveStartWeekday();
  let pick = await llmPickAssignment(input, enriched, []);
  let routed = trySolve(pick, enriched, input, startWeekday);

  for (let attempt = 1; routed.kind === "infeasible" && attempt <= MAX_REPAIR_ATTEMPTS; attempt++) {
    pick = await llmPickAssignment(input, enriched, routed.issues, pick);
    routed = trySolve(pick, enriched, input, startWeekday);
  }

  if (routed.kind === "infeasible") {
    throw new GenerationFailedError(
      "irreparable",
      `Solver still infeasible after ${MAX_REPAIR_ATTEMPTS} repair attempts: ` +
        routed.issues.map((i) => `day ${i.dayNumber}/${i.reason}`).join(", ")
    );
  }

  // 5. Persist as private trip template
  return persistTemplate(input, pick, routed.days, enriched);
}

// ─── Steps ──────────────────────────────────────────────────────────────────

function validateAnswers(input: GenerateInput): void {
  const a = input.answers;
  if (!a.duration_days || a.duration_days < 1 || a.duration_days > 30) {
    throw new GenerationFailedError("invalid_answers", "duration_days must be 1–30");
  }
  if (!a.party || !a.party_size || !a.budget_tier || !a.pace) {
    throw new GenerationFailedError("invalid_answers", "missing required survey fields");
  }
  if (!a.destination) {
    // "decide later" lives at the survey layer; the generator requires a concrete city.
    throw new GenerationFailedError("invalid_answers", "destination is required for generation");
  }
}

interface PickPromptInput {
  answers: GenerateInput["answers"];
  shortlist: EnrichedPoi[];
  prior?: PickResult;
  issues: InfeasibilityIssue[];
}

async function llmPickAssignment(
  input: GenerateInput,
  shortlist: EnrichedPoi[],
  issues: InfeasibilityIssue[],
  prior?: PickResult
): Promise<PickResult> {
  const system = [
    `你正在從候選清單中,為 ${input.answers.destination} 的 ${input.answers.duration_days} 天行程挑選並分配每天的景點。`,
    `團體類型:${input.answers.party}(${input.answers.party_size} 人)。預算:${input.answers.budget_tier}。節奏:${input.answers.pace}。氛圍:${(input.answers.vibe ?? []).join("、") || "均衡"}。`,
    input.answers.must_haves ? `額外需求:${input.answers.must_haves}` : null,
    "規則:",
    "1) 你只能使用候選清單中的 place_id;不可虛構或新增。",
    `2) 每日選 3–6 個地點(依照節奏:chill ≤3 / balanced 3–5 / packed 5–6)。`,
    "3) 每天請至少安排一家餐廳。",
    "4) 不要重複使用同一個 place_id。",
    "5) title、summary、tags 用繁體中文。",
    'JSON 結構:{ title, summary, tags[], days: [{ day_number, place_ids: ["..."] }] }',
  ]
    .filter(Boolean)
    .join("\n");

  const repairBlock =
    issues.length > 0 && prior
      ? [
          "前次安排不可行,請修正下列問題並重新分配 place_id(可保留可行的天):",
          ...issues.map((i) => `- 第 ${i.dayNumber} 天:${i.reason}(${i.detail})。問題 place_id:${i.offendingPlaceIds.join(", ") || "—"}`),
          `前次安排:${JSON.stringify(prior.days)}`,
        ].join("\n")
      : null;

  const userPayload = {
    instruction: repairBlock ?? "請從候選清單中挑選並分配每天的地點。",
    shortlist: shortlist.map((p) => ({
      place_id: p.placeId,
      name: p.name,
      type: p.itemType,
      tags: p.tags,
      summary: p.description.slice(0, 240),
    })),
  };

  let raw: unknown;
  try {
    raw = await generateJson<unknown>(system, JSON.stringify(userPayload));
  } catch (err) {
    if (err instanceof GeminiUnavailableError) {
      throw new GenerationFailedError("gemini_unavailable");
    }
    throw err;
  }
  const parsed = PickSchema.safeParse(raw);
  if (!parsed.success) throw new GenerationFailedError("schema_invalid", parsed.error.message);

  // Defense in depth: drop any hallucinated place_ids and dedupe across days.
  const valid = new Set(shortlist.map((p) => p.placeId));
  const seen = new Set<string>();
  parsed.data.days = parsed.data.days.map((d) => ({
    ...d,
    place_ids: d.place_ids.filter((id) => {
      if (!valid.has(id) || seen.has(id)) return false;
      seen.add(id);
      return true;
    }),
  }));

  return parsed.data;
}

type SolveTry =
  | { kind: "feasible"; days: RoutedDay[] }
  | { kind: "infeasible"; issues: InfeasibilityIssue[] };

function trySolve(
  pick: PickResult,
  enriched: EnrichedPoi[],
  input: GenerateInput,
  startWeekday: number
): SolveTry {
  const byId = new Map(enriched.map((p) => [p.placeId, p]));
  const daysAssignment: EnrichedPoi[][] = [];
  for (let d = 1; d <= input.answers.duration_days!; d++) {
    const slot = pick.days.find((x) => x.day_number === d);
    const pois = (slot?.place_ids ?? []).map((id) => byId.get(id)).filter((v): v is EnrichedPoi => v != null);
    daysAssignment.push(pois);
  }

  const result = solveItinerary({
    daysAssignment,
    pace: input.answers.pace,
    startWeekday,
  });
  return result.ok
    ? { kind: "feasible", days: result.days }
    : { kind: "infeasible", issues: result.issues };
}

// _ marker silences the prompt-only PickPromptInput type; keep it exported-shape
// so future callers (web wizard preview) can reuse the same brief.
export type { PickPromptInput };

async function persistTemplate(
  input: GenerateInput,
  pick: PickResult,
  routedDays: RoutedDay[],
  enriched: EnrichedPoi[]
): Promise<GenerateOutput> {
  const db = createAdminClient();
  const byId = new Map(enriched.map((p) => [p.placeId, p]));

  const items = routedDays.flatMap((day) =>
    day.stops.map((stop, idx) => {
      const poi = byId.get(stop.poi.placeId);
      return {
        day_number: day.dayNumber,
        order_index: idx,
        item_type: stop.poi.itemType,
        title: poi?.name ?? stop.poi.name,
        notes: formatArrival(stop.arriveMinutes),
        place_name: poi?.name ?? null,
        address: poi?.live?.address ?? null,
        lat: poi?.lat ?? null,
        lng: poi?.lng ?? null,
        external_url: null as string | null,
        duration_minutes: stop.departMinutes - stop.arriveMinutes,
      };
    })
  );

  const slug = generateSlug(pick.title);
  const contentHash = computeContentHash(items, pick.title, pick.summary);

  const { data: tmpl, error: tmplErr } = await db
    .from("trip_templates")
    .insert({ author_line_user_id: input.authorLineUserId, slug, visibility: "private" })
    .select("id")
    .single();
  if (tmplErr || !tmpl) throw new GenerationFailedError("persist_failed", tmplErr?.message);

  const templateId = tmpl.id as string;

  const { data: version, error: verErr } = await db
    .from("trip_template_versions")
    .insert({
      template_id: templateId,
      version_number: 1,
      title: pick.title,
      destination_name: input.answers.destination ?? "",
      duration_days: input.answers.duration_days!,
      summary: pick.summary,
      tags: pick.tags,
      content_hash: contentHash,
    })
    .select("id")
    .single();
  if (verErr || !version) throw new GenerationFailedError("persist_failed", verErr?.message);

  const versionId = version.id as string;

  if (items.length > 0) {
    const { error: itemErr } = await db
      .from("trip_template_items")
      .insert(items.map((i) => ({ ...i, version_id: versionId })));
    if (itemErr) throw new GenerationFailedError("persist_failed", itemErr.message);
  }

  await db.from("trip_templates").update({ current_version_id: versionId }).eq("id", templateId);

  return { templateId, versionId };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function deriveStartWeekday(): number {
  return new Date().getDay();
}

function formatArrival(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `預計抵達 ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function generateSlug(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 40);
  const suffix = randomBytes(4).toString("hex");
  return base ? `${base}-${suffix}` : suffix;
}

function computeContentHash(
  items: Array<{
    day_number: number;
    order_index: number;
    item_type: string;
    title: string;
    notes: string | null;
    place_name: string | null;
    address: string | null;
    external_url: string | null;
    duration_minutes: number | null;
  }>,
  title: string,
  summary: string | null
): string {
  const canonical = JSON.stringify({
    title,
    summary,
    items: items.map((i) => ({
      day: i.day_number,
      order: i.order_index,
      type: i.item_type,
      title: i.title,
      notes: i.notes,
      place: i.place_name,
      address: i.address,
      url: i.external_url,
      minutes: i.duration_minutes,
    })),
  });
  return createHash("sha256").update(canonical).digest("hex");
}

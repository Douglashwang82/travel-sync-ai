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
import {
  searchPoisByVibe,
  enrichWithLiveData,
  loadPoisByIds,
  type EnrichedPoi,
  type PoiCandidate,
} from "./poi-engine";
import {
  searchRoutesByVibe,
  composeFromRoutes,
  type RouteCandidate,
  type RouteComposition,
} from "./route-engine";
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
  const destination = input.answers.destination!;
  const durationDays = input.answers.duration_days!;

  // 1. Route layer — curated 1-day routes (may be empty).
  const routes = await searchRoutesByVibe({
    destination,
    vibe: input.answers.vibe,
    pace: input.answers.pace,
    budget: input.answers.budget_tier,
    k: 10,
  });
  const compose: RouteComposition = composeFromRoutes(routes, durationDays);

  // 2. POI layer — always retrieved. Routes can fail at solve time and demote
  //    days to the LLM flow on repair, so the LLM needs a candidate pool ready.
  const poiCandidates = await searchPoisByVibe({
    destination,
    vibe: input.answers.vibe,
    pace: input.answers.pace,
    budget: input.answers.budget_tier,
    k: 30,
  });

  // 3. Materialize route place_ids as PoiCandidates and union with POI search.
  const routePois = await loadPoisByIds(Array.from(compose.usedPlaceIds));
  const allCandidates = unionByPlaceId(routePois, poiCandidates);
  if (allCandidates.length === 0) {
    throw new GenerationFailedError("no_candidates", "no routes or POIs available");
  }
  const enriched = await enrichWithLiveData(allCandidates);

  // 4. LLM pick → 5. solve → 6. repair loop (now also demotes failed routes).
  const startWeekday = deriveStartWeekday();
  let pick: PickResult | null = null;
  let routed: SolveTry | null = null;

  for (let attempt = 0; attempt <= MAX_REPAIR_ATTEMPTS; attempt++) {
    if (compose.uncoveredDays.length > 0) {
      const llmIssues = routed?.kind === "infeasible" ? issuesForLlmDays(routed.issues, compose) : [];
      pick = await llmPickAssignment(input, enriched, llmIssues, pick ?? undefined, {
        onlyDays: compose.uncoveredDays,
        excludePlaceIds: compose.usedPlaceIds,
      });
    }

    routed = trySolve(pick, enriched, input, startWeekday, compose);
    if (routed.kind === "feasible") break;

    // Demote any preordered-day failures so the next attempt's LLM call
    // covers those days. Place_ids freed by the dropped route become
    // eligible again for the LLM shortlist.
    if (attempt < MAX_REPAIR_ATTEMPTS) {
      demoteFailedRoutes(routed.issues, compose);
    }
  }

  if (!routed || routed.kind === "infeasible") {
    const issues = routed?.kind === "infeasible" ? routed.issues : [];
    throw new GenerationFailedError(
      "irreparable",
      `Solver still infeasible after ${MAX_REPAIR_ATTEMPTS} repair attempts: ` +
        issues.map((i) => `day ${i.dayNumber}/${i.reason}`).join(", ")
    );
  }

  // 7. Persist as private trip template. When the LLM never ran (all days
  //    were route-covered first try), synthesize the title/summary/tags
  //    from the routes themselves.
  const finalPick = pick ?? synthesizePickFromRoutes(compose, destination);
  return persistTemplate(input, finalPick, routed.days, enriched);
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

interface PickConstraints {
  /** When set, the LLM is asked to pick only for these day numbers. */
  onlyDays?: number[];
  /** When set, these place_ids are filtered out of the shortlist (route-reserved). */
  excludePlaceIds?: Set<string>;
}

async function llmPickAssignment(
  input: GenerateInput,
  shortlist: EnrichedPoi[],
  issues: InfeasibilityIssue[],
  prior?: PickResult,
  constraints?: PickConstraints
): Promise<PickResult> {
  const onlyDays = constraints?.onlyDays;
  const excludeIds = constraints?.excludePlaceIds ?? new Set<string>();
  const filteredShortlist = shortlist.filter((p) => !excludeIds.has(p.placeId));
  const daysClause = onlyDays && onlyDays.length > 0
    ? `本次僅需安排以下天數(其他天已由策展路線覆蓋):${onlyDays.join("、")}`
    : `共 ${input.answers.duration_days} 天`;

  const system = [
    `你正在從候選清單中,為 ${input.answers.destination} 的 ${input.answers.duration_days} 天行程挑選並分配每天的景點。`,
    `團體類型:${input.answers.party}(${input.answers.party_size} 人)。預算:${input.answers.budget_tier}。節奏:${input.answers.pace}。氛圍:${(input.answers.vibe ?? []).join("、") || "均衡"}。`,
    input.answers.must_haves ? `額外需求:${input.answers.must_haves}` : null,
    daysClause,
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
    shortlist: filteredShortlist.map((p) => ({
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

  // Defense in depth: drop hallucinated/excluded place_ids, dedupe across days,
  // and (when constrained) drop any day_number outside onlyDays.
  const valid = new Set(filteredShortlist.map((p) => p.placeId));
  const allowedDays = onlyDays && onlyDays.length > 0 ? new Set(onlyDays) : null;
  const seen = new Set<string>();
  parsed.data.days = parsed.data.days
    .filter((d) => (allowedDays ? allowedDays.has(d.day_number) : true))
    .map((d) => ({
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
  pick: PickResult | null,
  enriched: EnrichedPoi[],
  input: GenerateInput,
  startWeekday: number,
  compose: RouteComposition
): SolveTry {
  const byId = new Map(enriched.map((p) => [p.placeId, p]));
  const daysAssignment: EnrichedPoi[][] = [];
  const preorderedDays: boolean[] = [];

  for (let d = 1; d <= input.answers.duration_days!; d++) {
    const route = compose.coveredDays.get(d);
    if (route) {
      const pois = route.placeIds
        .map((id) => byId.get(id))
        .filter((v): v is EnrichedPoi => v != null);
      daysAssignment.push(pois);
      preorderedDays.push(true);
      continue;
    }
    const slot = pick?.days.find((x) => x.day_number === d);
    const pois = (slot?.place_ids ?? [])
      .map((id) => byId.get(id))
      .filter((v): v is EnrichedPoi => v != null);
    daysAssignment.push(pois);
    preorderedDays.push(false);
  }

  const result = solveItinerary({
    daysAssignment,
    pace: input.answers.pace,
    startWeekday,
    preorderedDays,
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

function unionByPlaceId(a: PoiCandidate[], b: PoiCandidate[]): PoiCandidate[] {
  const seen = new Set<string>();
  const out: PoiCandidate[] = [];
  for (const c of [...a, ...b]) {
    if (seen.has(c.placeId)) continue;
    seen.add(c.placeId);
    out.push(c);
  }
  return out;
}

function issuesForLlmDays(issues: InfeasibilityIssue[], compose: RouteComposition): InfeasibilityIssue[] {
  // Repair feedback should only mention days the LLM actually picked for —
  // route-day failures are handled by demoteFailedRoutes, not by asking the
  // LLM to swap.
  return issues.filter((i) => !compose.coveredDays.has(i.dayNumber));
}

function demoteFailedRoutes(issues: InfeasibilityIssue[], compose: RouteComposition): void {
  for (const issue of issues) {
    const route = compose.coveredDays.get(issue.dayNumber);
    if (!route) continue;
    compose.coveredDays.delete(issue.dayNumber);
    compose.uncoveredDays.push(issue.dayNumber);
    for (const id of route.placeIds) compose.usedPlaceIds.delete(id);
  }
  compose.uncoveredDays.sort((a, b) => a - b);
}

function synthesizePickFromRoutes(compose: RouteComposition, destination: string): PickResult {
  const routes = Array.from(compose.coveredDays.values());
  if (routes.length === 0) {
    // Shouldn't happen — we only synthesize when at least one route covered a day —
    // but keep the shape valid in case.
    return { title: `${destination} Highlights`, summary: `A curated trip to ${destination}.`, tags: [], days: [] };
  }
  const title = routes.length === 1 ? routes[0].title : `${destination} — ${routes[0].title} + more`;
  const summary = routes.map((r) => r.summary).join(" ").slice(0, 800);
  const tags = Array.from(new Set(routes.flatMap((r) => r.vibeTags))).slice(0, 8);
  return { title, summary, tags, days: [] };
}

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

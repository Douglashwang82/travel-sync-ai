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
import { logger } from "@/lib/logger";
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
import { detectJapanSkiDestination } from "@/lib/ski-destination";
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
  const genId = randomBytes(4).toString("hex");

  logger.info("[gen] pipeline start", {
    genId,
    destination,
    durationDays,
    party: input.answers.party,
    partySize: input.answers.party_size,
    budget: input.answers.budget_tier,
    pace: input.answers.pace,
    vibe: (input.answers.vibe ?? []).join(",") || "(none)",
    mustHaves: input.answers.must_haves?.slice(0, 200) ?? undefined,
  });

  // 1. Route layer — curated 1-day routes (may be empty).
  const routes = await searchRoutesByVibe({
    destination,
    vibe: input.answers.vibe,
    pace: input.answers.pace,
    budget: input.answers.budget_tier,
    k: 10,
    genId,
  });
  logger.info("[gen] phase 1: routes", {
    genId,
    count: routes.length,
    topTitles: routes.slice(0, 5).map((r) => r.title).join(" | ") || "(none)",
    topScores: routes.slice(0, 5).map((r) => r.finalScore.toFixed(3)).join(",") || "(none)",
  });
  const compose: RouteComposition = composeFromRoutes(routes, durationDays);
  logger.info("[gen] phase 1: route composition", {
    genId,
    coveredDays: Array.from(compose.coveredDays.entries())
      .map(([d, r]) => `D${d}=${r.title}`)
      .join(" | ") || "(none)",
    uncoveredDays: compose.uncoveredDays.join(",") || "(none)",
    usedPlaceCount: compose.usedPlaceIds.size,
  });

  // 2. POI layer — always retrieved. Routes can fail at solve time and demote
  //    days to the LLM flow on repair, so the LLM needs a candidate pool ready.
  const poiCandidates = await searchPoisByVibe({
    destination,
    vibe: input.answers.vibe,
    pace: input.answers.pace,
    budget: input.answers.budget_tier,
    k: 30,
    genId,
  });
  logger.info("[gen] phase 2: poi candidates", {
    genId,
    count: poiCandidates.length,
    byType: summarizeByType(poiCandidates),
    similarityRange: poiCandidates.length
      ? `${poiCandidates[poiCandidates.length - 1].similarity.toFixed(3)}..${poiCandidates[0].similarity.toFixed(3)}`
      : "(empty)",
    topNames: poiCandidates.slice(0, 8).map((p) => p.name).join(" | "),
  });

  // 3. Materialize route place_ids as PoiCandidates and union with POI search.
  const routePois = await loadPoisByIds(Array.from(compose.usedPlaceIds), genId);
  const allCandidates = unionByPlaceId(routePois, poiCandidates);
  if (allCandidates.length === 0) {
    logger.error("[gen] phase 2: no candidates available", { genId, destination });
    throw new GenerationFailedError("no_candidates", "no routes or POIs available");
  }
  const enriched = await enrichWithLiveData(allCandidates);
  logger.info("[gen] phase 2: enrichment", {
    genId,
    total: enriched.length,
    withCoords: enriched.filter((e) => e.lat != null && e.lng != null).length,
    withOpeningHours: enriched.filter((e) => (e.live?.openingPeriods?.length ?? 0) > 0).length,
    withLiveData: enriched.filter((e) => e.live != null).length,
  });

  // 4. LLM pick → 5. solve → 6. repair loop (now also demotes failed routes).
  const startWeekday = deriveStartWeekday();
  let pick: PickResult | null = null;
  let routed: SolveTry | null = null;

  for (let attempt = 0; attempt <= MAX_REPAIR_ATTEMPTS; attempt++) {
    logger.info("[gen] phase 3: attempt start", {
      genId,
      attempt,
      uncoveredDays: compose.uncoveredDays.join(",") || "(all routes-covered)",
      coveredDays: Array.from(compose.coveredDays.keys()).join(",") || "(none)",
    });

    if (compose.uncoveredDays.length > 0) {
      const llmIssues = routed?.kind === "infeasible" ? issuesForLlmDays(routed.issues, compose) : [];
      pick = await llmPickAssignment(input, enriched, llmIssues, pick ?? undefined, {
        onlyDays: compose.uncoveredDays,
        excludePlaceIds: compose.usedPlaceIds,
        genId,
        attempt,
      });
      const byId = new Map(enriched.map((p) => [p.placeId, p]));
      logger.info("[gen] phase 3: llm pick", {
        genId,
        attempt,
        title: pick.title,
        tags: pick.tags.join(",") || "(none)",
        days: pick.days
          .map((d) => `D${d.day_number}=[${d.place_ids.map((id) => byId.get(id)?.name ?? id.slice(0, 8)).join(" | ")}]`)
          .join("  ") || "(empty)",
      });
    } else {
      logger.info("[gen] phase 3: llm skipped — all days route-covered", { genId, attempt });
    }

    routed = trySolve(pick, enriched, input, startWeekday, compose);
    if (routed.kind === "feasible") {
      logger.info("[gen] phase 4: solver feasible", {
        genId,
        attempt,
        days: routed.days
          .map((d) => `D${d.dayNumber}=${d.stops.length}stops(${d.stops.map((s) => s.poi.name).join("→")})`)
          .join(" | "),
      });
      break;
    }

    logger.warn("[gen] phase 4: solver infeasible", {
      genId,
      attempt,
      issues: routed.issues
        .map((i) => `D${i.dayNumber}/${i.reason}: ${i.detail}`)
        .join(" | "),
    });
    diagnoseSolverIssues(genId, attempt, routed.issues, enriched, startWeekday);

    // Demote any preordered-day failures so the next attempt's LLM call
    // covers those days. Place_ids freed by the dropped route become
    // eligible again for the LLM shortlist.
    if (attempt < MAX_REPAIR_ATTEMPTS) {
      const demoted = demoteFailedRoutes(routed.issues, compose);
      if (demoted.length > 0) {
        logger.info("[gen] phase 4: demoted failed routes", {
          genId,
          attempt,
          demotedDays: demoted.join(","),
        });
      }
    }
  }

  if (!routed || routed.kind === "infeasible") {
    const issues = routed?.kind === "infeasible" ? routed.issues : [];
    logger.error("[gen] pipeline failed: irreparable", {
      genId,
      attempts: MAX_REPAIR_ATTEMPTS + 1,
      issues: issues.map((i) => `D${i.dayNumber}/${i.reason}: ${i.detail}`).join(" | ") || "(none)",
      offendingPlaceIds: issues
        .flatMap((i) => i.offendingPlaceIds)
        .slice(0, 20)
        .join(","),
    });
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
  const out = await persistTemplate(input, finalPick, routed.days, enriched, compose);
  logger.info("[gen] pipeline succeeded", {
    genId,
    templateId: out.templateId,
    versionId: out.versionId,
    totalStops: routed.days.reduce((acc, d) => acc + d.stops.length, 0),
  });
  return out;
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
  /** Trace correlation id propagated from runGenerationPipeline. */
  genId?: string;
  /** Repair-loop attempt index (0 = first pass). */
  attempt?: number;
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
  const genId = constraints?.genId;
  const attempt = constraints?.attempt ?? 0;
  logger.info("[gen] phase 3: llm input", {
    genId,
    attempt,
    onlyDays: (onlyDays ?? []).join(",") || "(all)",
    shortlistSize: filteredShortlist.length,
    shortlistByType: summarizeByType(filteredShortlist),
    repairIssues: issues.map((i) => `D${i.dayNumber}/${i.reason}`).join(",") || "(none)",
    hadPrior: prior != null,
  });
  const daysClause = onlyDays && onlyDays.length > 0
    ? `本次僅需安排以下天數(其他天已由策展路線覆蓋):${onlyDays.join("、")}`
    : `共 ${input.answers.duration_days} 天`;

  const skiMatch = detectJapanSkiDestination(input.answers.destination);
  const skiHint = skiMatch.match
    ? `這是 ${skiMatch.region.region}(${skiMatch.region.prefecture}) 的日本滑雪行程。每天節奏建議:` +
      `上午雪場 → 山上/山腰午餐 → 下午雪場或溫泉 → 晚餐(餐廳)。` +
      `行程 4 天以上請至少安排一天以溫泉為主。優先挑選 tags 含 ski_resort / onsen / ski_in_ski_out 的地點。`
    : null;

  const system = [
    `你正在從候選清單中,為 ${input.answers.destination} 的 ${input.answers.duration_days} 天行程挑選並分配每天的景點。`,
    `團體類型:${input.answers.party}(${input.answers.party_size} 人)。預算:${input.answers.budget_tier}。節奏:${input.answers.pace}。氛圍:${(input.answers.vibe ?? []).join("、") || "均衡"}。`,
    input.answers.must_haves ? `額外需求:${input.answers.must_haves}` : null,
    daysClause,
    skiHint,
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
      logger.error("[gen] phase 3: gemini unavailable", { genId, attempt });
      throw new GenerationFailedError("gemini_unavailable");
    }
    throw err;
  }
  const parsed = PickSchema.safeParse(raw);
  if (!parsed.success) {
    logger.error("[gen] phase 3: llm schema invalid", {
      genId,
      attempt,
      error: parsed.error.message.slice(0, 400),
    });
    throw new GenerationFailedError("schema_invalid", parsed.error.message);
  }

  // Defense in depth: drop hallucinated/excluded place_ids, dedupe across days,
  // and (when constrained) drop any day_number outside onlyDays.
  const valid = new Set(filteredShortlist.map((p) => p.placeId));
  const allowedDays = onlyDays && onlyDays.length > 0 ? new Set(onlyDays) : null;
  const seen = new Set<string>();
  const rawDayCount = parsed.data.days.length;
  const rawIdCount = parsed.data.days.reduce((a, d) => a + d.place_ids.length, 0);
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
  const keptIdCount = parsed.data.days.reduce((a, d) => a + d.place_ids.length, 0);
  if (rawIdCount !== keptIdCount || rawDayCount !== parsed.data.days.length) {
    logger.warn("[gen] phase 3: llm output filtered", {
      genId,
      attempt,
      rawDayCount,
      keptDayCount: parsed.data.days.length,
      rawIdCount,
      keptIdCount,
    });
  }

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
  enriched: EnrichedPoi[],
  compose: RouteComposition
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

  // Accumulate a usage signal on routes that contributed. Fire-and-forget:
  // a quality-score blip should never fail a successful generation.
  const usedRouteIds = Array.from(new Set(Array.from(compose.coveredDays.values()).map((r) => r.routeId)));
  if (usedRouteIds.length > 0) {
    db.rpc("bump_route_quality", { p_route_ids: usedRouteIds, p_delta: 1 })
      .then(({ error }) => {
        if (error) logger.error("[gen] bump_route_quality failed", { error: String(error.message ?? error) });
      });
  }

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

function demoteFailedRoutes(issues: InfeasibilityIssue[], compose: RouteComposition): number[] {
  const demoted: number[] = [];
  for (const issue of issues) {
    const route = compose.coveredDays.get(issue.dayNumber);
    if (!route) continue;
    compose.coveredDays.delete(issue.dayNumber);
    compose.uncoveredDays.push(issue.dayNumber);
    for (const id of route.placeIds) compose.usedPlaceIds.delete(id);
    demoted.push(issue.dayNumber);
  }
  compose.uncoveredDays.sort((a, b) => a - b);
  return demoted;
}

function summarizeByType(pois: Array<{ itemType: string }>): string {
  const counts: Record<string, number> = {};
  for (const p of pois) counts[p.itemType] = (counts[p.itemType] ?? 0) + 1;
  return Object.entries(counts)
    .sort(([, a], [, b]) => b - a)
    .map(([t, n]) => `${t}=${n}`)
    .join(",");
}

function formatMinutes(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

function diagnoseSolverIssues(
  genId: string,
  attempt: number,
  issues: InfeasibilityIssue[],
  enriched: EnrichedPoi[],
  startWeekday: number
): void {
  const byId = new Map(enriched.map((p) => [p.placeId, p]));
  for (const issue of issues) {
    const weekday = (startWeekday + issue.dayNumber - 1) % 7;
    const offending = issue.offendingPlaceIds.map((id) => {
      const p = byId.get(id);
      if (!p) return `${id.slice(0, 8)}(missing)`;
      const windows =
        (p.live?.openingPeriods ?? [])
          .filter((period) => period.openDay === weekday)
          .map((period) => `${formatMinutes(period.openMinutes)}-${formatMinutes(period.closeMinutes)}`)
          .join("/") || "no-hours";
      const coords =
        p.lat != null && p.lng != null
          ? `${p.lat.toFixed(3)},${p.lng.toFixed(3)}`
          : "no-coords";
      return `${p.name}[${p.itemType}|${coords}|${windows}]`;
    });
    logger.warn("[gen] phase 4: diagnosis", {
      genId,
      attempt,
      day: issue.dayNumber,
      weekday,
      reason: issue.reason,
      detail: issue.detail,
      offending: offending.join(" ; ") || "(none)",
    });
  }
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

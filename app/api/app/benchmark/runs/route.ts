import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/app-server";
import {
  BenchmarkScenarioSchema,
  loadPresetScenarios,
  listBenchmarkRuns,
  runBenchmarkScenario,
  type BenchmarkRunRecord,
} from "@/services/trip-generation/benchmark-runner";

export const dynamic = "force-dynamic";
// Generation + judging is a multi-LLM-call pipeline; give it headroom beyond
// the default serverless budget (same class of work as /api/app/trips/generate).
export const maxDuration = 300;

export interface BenchmarkRunsResponse {
  runs: BenchmarkRunRecord[];
}

export interface BenchmarkRunResponse {
  run: BenchmarkRunRecord;
}

const ListQuerySchema = z.object({
  scenario: z.string().min(1).max(80).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

/**
 * List benchmark run history (newest first) from the `benchmark_runs` table.
 * Optional query params: `scenario` (filter by scenario id) and `limit`
 * (default 50, max 200). Rows include per-metric scores, stats and the judge
 * verdict, so the client needs no follow-up detail fetch.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAppUser(req);
  if (!auth.ok) return auth.response;

  const parsed = ListQuerySchema.safeParse(
    Object.fromEntries(req.nextUrl.searchParams.entries())
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid query", code: "INVALID_QUERY", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  try {
    const runs = await listBenchmarkRuns({
      scenarioId: parsed.data.scenario,
      limit: parsed.data.limit,
    });
    return NextResponse.json<BenchmarkRunsResponse>({ runs });
  } catch (err) {
    console.error("[benchmark/runs] list failed", err);
    return NextResponse.json(
      { error: "Failed to load benchmark history", code: "HISTORY_UNAVAILABLE" },
      { status: 500 }
    );
  }
}

const RunBodySchema = z
  .object({
    /** Run a preset from benchmarks/scenarios.json by id… */
    scenarioId: z.string().min(1).max(80).optional(),
    /** …or an inline ad-hoc scenario. Exactly one of the two must be set. */
    scenario: BenchmarkScenarioSchema.omit({ id: true }).optional(),
    judge: z.boolean().optional(),
  })
  .refine((b) => (b.scenarioId != null) !== (b.scenario != null), {
    message: "provide exactly one of scenarioId or scenario",
  });

/**
 * Execute a benchmark run now: generate a real itinerary through the
 * production pipeline, score the persisted template with the deterministic
 * benchmark, optionally grade it with the LLM-as-judge (`judge`, default
 * true), and record the outcome in `benchmark_runs`. Synchronous — the
 * response is the completed run row (ok=false rows carry the failure
 * reason). Costs real LLM calls.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAppUser(req);
  if (!auth.ok) return auth.response;

  let body: z.infer<typeof RunBodySchema>;
  try {
    body = RunBodySchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      {
        error: "Invalid body",
        code: "INVALID_BODY",
        details: err instanceof z.ZodError ? err.flatten() : String(err),
      },
      { status: 400 }
    );
  }

  let scenario;
  if (body.scenarioId) {
    const presets = await loadPresetScenarios().catch(() => []);
    scenario = presets.find((s) => s.id === body.scenarioId);
    if (!scenario) {
      return NextResponse.json(
        { error: `Unknown scenario '${body.scenarioId}'`, code: "SCENARIO_NOT_FOUND" },
        { status: 404 }
      );
    }
  } else {
    scenario = { id: "adhoc", ...body.scenario! };
  }

  try {
    const { record } = await runBenchmarkScenario({
      scenario,
      source: "web",
      judge: body.judge,
      gitRev: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
      triggeredBy: auth.lineUserId,
    });
    return NextResponse.json<BenchmarkRunResponse>({ run: record });
  } catch (err) {
    // The runner records pipeline failures as ok=false rows; reaching here
    // means something outside the run itself broke (e.g. presets unreadable).
    console.error("[benchmark/runs] unexpected error", err);
    return NextResponse.json(
      { error: "Benchmark run failed unexpectedly", code: "RUN_FAILED" },
      { status: 500 }
    );
  }
}

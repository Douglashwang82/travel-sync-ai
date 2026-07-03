import { NextRequest, NextResponse } from "next/server";
import { requireAppUser } from "@/lib/app-server";
import {
  loadPresetScenarios,
  type BenchmarkScenario,
} from "@/services/trip-generation/benchmark-runner";

export const dynamic = "force-dynamic";

export interface BenchmarkScenariosResponse {
  scenarios: BenchmarkScenario[];
}

/**
 * List the preset benchmark scenarios (benchmarks/scenarios.json) that can be
 * run from the /app/benchmark page. Presets are checked into the repo; ad-hoc
 * scenarios are submitted inline via POST /api/app/benchmark/runs.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAppUser(req);
  if (!auth.ok) return auth.response;

  try {
    const scenarios = await loadPresetScenarios();
    return NextResponse.json<BenchmarkScenariosResponse>({ scenarios });
  } catch (err) {
    console.error("[benchmark/scenarios] failed to load presets", err);
    return NextResponse.json(
      { error: "Failed to load scenarios", code: "SCENARIOS_UNAVAILABLE" },
      { status: 500 }
    );
  }
}

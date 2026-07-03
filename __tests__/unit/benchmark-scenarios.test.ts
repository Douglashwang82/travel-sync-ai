import { describe, it, expect } from "vitest";
import {
  loadPresetScenarios,
  BenchmarkScenarioSchema,
} from "@/services/trip-generation/benchmark-runner";

// benchmarks/scenarios.json is hand-edited; both the CLI and the /app/benchmark
// UI parse it with BenchmarkScenarioSchema, so a malformed entry would break
// every benchmark surface at once. Keep it valid here.
describe("benchmarks/scenarios.json", () => {
  it("parses against BenchmarkScenarioSchema with unique ids", async () => {
    const scenarios = await loadPresetScenarios();
    expect(scenarios.length).toBeGreaterThan(0);
    for (const s of scenarios) {
      expect(() => BenchmarkScenarioSchema.parse(s)).not.toThrow();
      // 'adhoc' is reserved for web one-off runs
      expect(s.id).not.toBe("adhoc");
    }
    expect(new Set(scenarios.map((s) => s.id)).size).toBe(scenarios.length);
  });
});

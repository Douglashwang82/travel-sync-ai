import { describe, it, expect } from "vitest";
import { normalizeAliases } from "@/lib/destination-aliases";

describe("normalizeAliases", () => {
  it("lowercases, trims, dedupes, drops empties", () => {
    const out = normalizeAliases([" Hokkaido ", "hokkaido", "北海道", "", null, "Japan", "japan"]);
    expect(out).toEqual(["hokkaido", "北海道", "japan"]);
  });

  it("preserves first-occurrence order", () => {
    const out = normalizeAliases(["B", "a", "B", "C"]);
    expect(out).toEqual(["b", "a", "c"]);
  });

  it("returns an empty array for an empty input", () => {
    expect(normalizeAliases([])).toEqual([]);
  });
});

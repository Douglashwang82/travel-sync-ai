import { describe, it, expect } from "vitest";
import { skiPrefsToVibe } from "@/services/trip-generation/ski-prefs";
import { nextStepAfter } from "@/services/trip-generation/survey";

describe("skiPrefsToVibe", () => {
  it("powder + advanced + onsen must-have → adventure + relaxed + nature", () => {
    const v = skiPrefsToVibe({
      level: "advanced",
      terrain: "powder",
      onsen_priority: "must_have",
      family_friendly: false,
      non_ski_days: 0,
    });
    expect(v).toEqual(expect.arrayContaining(["adventure", "relaxed", "nature"]));
    expect(v.length).toBeLessThanOrEqual(3);
  });

  it("beginner + groomers + family + 1 non-ski day", () => {
    const v = skiPrefsToVibe({
      level: "beginner",
      terrain: "groomers",
      onsen_priority: "nice_to_have",
      family_friendly: true,
      non_ski_days: 1,
    });
    expect(v).toContain("relaxed");
    expect(v).toContain("nature");
    expect(v.length).toBeLessThanOrEqual(3);
  });

  it("expert + backcountry + no onsen → adventure", () => {
    const v = skiPrefsToVibe({
      level: "expert",
      terrain: "backcountry",
      onsen_priority: "skip",
      family_friendly: false,
      non_ski_days: 0,
    });
    expect(v).toContain("adventure");
  });

  it("returns at least one vibe even for the blandest inputs", () => {
    const v = skiPrefsToVibe({
      level: "intermediate",
      terrain: "all_mountain",
      onsen_priority: "skip",
      family_friendly: false,
      non_ski_days: 0,
    });
    expect(v.length).toBeGreaterThan(0);
  });

  it("caps the output at 3 entries", () => {
    const v = skiPrefsToVibe({
      level: "expert",
      terrain: "powder",
      onsen_priority: "must_have",
      family_friendly: true,
      non_ski_days: 2,
    });
    expect(v.length).toBeLessThanOrEqual(3);
  });
});

describe("nextStepAfter — ski/non-ski branching", () => {
  it("budget_tier → ski_prefs when destination is a ski region", () => {
    expect(nextStepAfter("budget_tier", { destination: "Niseko" })).toBe("ski_prefs");
    expect(nextStepAfter("budget_tier", { destination: "Hakuba ski" })).toBe("ski_prefs");
  });

  it("budget_tier → vibe when destination is generic", () => {
    expect(nextStepAfter("budget_tier", { destination: "Osaka" })).toBe("vibe");
    expect(nextStepAfter("budget_tier", { destination: "Tokyo, Japan" })).toBe("vibe");
    expect(nextStepAfter("budget_tier", { destination: null })).toBe("vibe");
  });

  it("vibe always → pace (non-ski path stays linear)", () => {
    expect(nextStepAfter("vibe", { destination: "Osaka" })).toBe("pace");
  });

  it("ski_prefs → pace", () => {
    expect(nextStepAfter("ski_prefs", { destination: "Niseko" })).toBe("pace");
  });

  it("pace → must_haves regardless of branch", () => {
    expect(nextStepAfter("pace", { destination: "Niseko" })).toBe("must_haves");
    expect(nextStepAfter("pace", { destination: "Osaka" })).toBe("must_haves");
  });

  it("must_haves → done", () => {
    expect(nextStepAfter("must_haves", { destination: "Niseko" })).toBe("done");
  });
});

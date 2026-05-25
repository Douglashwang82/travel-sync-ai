// ─────────────────────────────────────────────────────────────────────────────
// Map ski_prefs (the v1 ski-trip survey answer) onto the existing
// `vibe` vocabulary used by poi-engine.ts / route-engine.ts /
// orchestrator.ts.
//
// We keep `vibe` as the internal lingua franca so the retrieval stack stays
// unchanged; ski destinations just get a richer survey UX whose output is
// translated here. This means a /plan run on a Japan ski destination always
// has both `ski_prefs` (raw) and `vibe` (derived) populated.
// ─────────────────────────────────────────────────────────────────────────────

import type { SkiPrefs, SurveyAnswers } from "./index";

type Vibe = NonNullable<SurveyAnswers["vibe"]>[number];

/**
 * Translate ski preferences to a small (≤3) ordered list of vibe tags.
 * Heuristics:
 *  - terrain=powder|backcountry|park → adventure
 *  - terrain=groomers|all_mountain → no explicit add (relies on level)
 *  - level=expert|advanced → adventure (overrides anything mellow)
 *  - level=beginner → relaxed
 *  - onsen_priority=must_have → relaxed + nature
 *  - onsen_priority=nice_to_have → relaxed
 *  - family_friendly=true → nature (closest existing vibe; no "family" enum)
 *  - non_ski_days >= 1 → culture (sightseeing intent)
 *
 * The vibe enum tops out at 3, so we prefer the strongest signals first.
 */
export function skiPrefsToVibe(prefs: SkiPrefs): Vibe[] {
  const ordered: Vibe[] = [];
  const push = (v: Vibe) => {
    if (!ordered.includes(v)) ordered.push(v);
  };

  // Highest-signal terrain / level first.
  if (prefs.terrain === "powder" || prefs.terrain === "backcountry" || prefs.terrain === "park") {
    push("adventure");
  }
  if (prefs.level === "expert" || prefs.level === "advanced") {
    push("adventure");
  }

  // Onsen / chill signals.
  if (prefs.onsen_priority === "must_have") {
    push("relaxed");
    push("nature");
  } else if (prefs.onsen_priority === "nice_to_have") {
    push("relaxed");
  }

  // Beginner trips skew chill.
  if (prefs.level === "beginner") push("relaxed");

  // Family trips: closest mapping is nature (onsens, scenic stops).
  if (prefs.family_friendly) push("nature");

  // Non-ski days suggest sightseeing.
  if (prefs.non_ski_days >= 1) push("culture");

  // Never return empty — fall back to a balanced adventure default.
  if (ordered.length === 0) ordered.push("adventure");

  return ordered.slice(0, 3);
}

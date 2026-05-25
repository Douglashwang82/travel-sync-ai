// Trip generation service — entry barrel.
//
// See design/trip-generation.md for the full design. This module is the
// shared backend for both the LINE /plan command and the web wizard at
// /app/trips/new.
//
// Status: scaffolding only. Survey state machine and Gemini call are TBD.

export type SurveyQuestionKey =
  | "destination"
  | "duration_days"
  | "party"
  | "party_size"
  | "budget_tier"
  | "vibe"
  | "ski_prefs"
  | "pace"
  | "must_haves";

/**
 * Linear default order. The LINE survey actually walks this conditionally:
 * if `answers.destination` resolves to a Japan ski region, the `vibe` step is
 * skipped in favour of `ski_prefs`, whose answer is mapped back to the vibe
 * vocabulary so downstream code (poi-engine, route-engine, orchestrator,
 * web wizard summary) never has to know about the branch.
 *
 * See nextStepAfter in services/trip-generation/survey.ts for the actual
 * state-machine transitions.
 */
export const SURVEY_STEP_ORDER: readonly SurveyQuestionKey[] = [
  "destination",
  "duration_days",
  "party",
  "party_size",
  "budget_tier",
  "vibe",
  "ski_prefs",
  "pace",
  "must_haves",
] as const;

/** v1 ski-preference shape — replaces `vibe` for Japan ski destinations. */
export interface SkiPrefs {
  /** Group's predominant skiing level. */
  level: "beginner" | "intermediate" | "advanced" | "expert";
  /** Preferred terrain style. */
  terrain: "groomers" | "all_mountain" | "powder" | "park" | "backcountry";
  /** How important onsen is on this trip. */
  onsen_priority: "must_have" | "nice_to_have" | "skip";
  /** Whether the trip is family-friendly (kids / ski school priority). */
  family_friendly: boolean;
  /** Number of full non-ski days expected (sightseeing, onsen-only, etc.). */
  non_ski_days: number;
}

export type SurveyAnswers = {
  destination?: string | null;
  duration_days?: number;
  party?: "solo" | "couple" | "family" | "friends";
  party_size?: number;
  budget_tier?: "shoestring" | "mid" | "luxury";
  vibe?: Array<"relaxed" | "adventure" | "culture" | "foodie" | "nightlife" | "nature">;
  ski_prefs?: SkiPrefs;
  pace?: "chill" | "balanced" | "packed";
  must_haves?: string | null;
};

export {
  startOrResumeSurvey,
  recordAnswer,
  abandonSurvey,
  getSession,
  markGenerated,
  markForked,
} from "./survey";
export type { SurveySession } from "./survey";
export { generateTemplateFromSurvey, GenerationFailedError } from "./generator";
export type { GenerationFailureReason } from "./generator";

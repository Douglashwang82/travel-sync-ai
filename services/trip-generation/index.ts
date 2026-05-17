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
  | "pace"
  | "must_haves";

export const SURVEY_STEP_ORDER: readonly SurveyQuestionKey[] = [
  "destination",
  "duration_days",
  "party",
  "party_size",
  "budget_tier",
  "vibe",
  "pace",
  "must_haves",
] as const;

export type SurveyAnswers = {
  destination?: string | null;
  duration_days?: number;
  party?: "solo" | "couple" | "family" | "friends";
  party_size?: number;
  budget_tier?: "shoestring" | "mid" | "luxury";
  vibe?: Array<"relaxed" | "adventure" | "culture" | "foodie" | "nightlife" | "nature">;
  pace?: "chill" | "balanced" | "packed";
  must_haves?: string | null;
};

export { startOrResumeSurvey, recordAnswer, abandonSurvey } from "./survey";
export { generateTemplateFromSurvey } from "./generator";

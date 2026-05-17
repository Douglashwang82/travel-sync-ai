// Public entry for the v1.2 three-tier itinerary generator. The heavy lifting
// (POI retrieval, LLM pick, solver, repair loop, persistence) lives in
// services/trip-generation/orchestrator.ts. This file is intentionally thin so
// callers (LINE postback handler, web POST route) only ever depend on a stable
// shape.
//
// See design/trip-generation.md.

import type { SurveyAnswers } from "./index";
import { runGenerationPipeline, GenerationFailedError } from "./orchestrator";

export interface GenerateInput {
  answers: SurveyAnswers;
  authorLineUserId: string;
}

export interface GenerateOutput {
  templateId: string;
  versionId: string;
}

export async function generateTemplateFromSurvey(input: GenerateInput): Promise<GenerateOutput> {
  return runGenerationPipeline(input);
}

export { GenerationFailedError };
export type { GenerationFailureReason } from "./orchestrator";

// Gemini-backed template generator — TODO.
//
// Takes completed survey answers, asks the LLM for a day-by-day skeleton,
// writes a private trip_template + version + items, returns the ids.
// Callers (bot postback handler, web API route) then invoke
// services/templates#forkTemplate to produce the live trip.

import type { SurveyAnswers } from "./index";

export interface GenerateInput {
  answers: SurveyAnswers;
  authorLineUserId: string;
}

export interface GenerateOutput {
  templateId: string;
  versionId: string;
}

export async function generateTemplateFromSurvey(_input: GenerateInput): Promise<GenerateOutput> {
  throw new Error("not implemented — see design/trip-generation.md");
}

// Survey state machine — TODO.
//
// Manages trip_survey_sessions rows: create, advance, abandon. Called by
// bot/commands/plan.ts (group entry) and the survey| postback branch in
// services/event-processor.ts.

import type { SurveyAnswers, SurveyQuestionKey } from "./index";

export interface SurveySession {
  id: string;
  status: "in_progress" | "generated" | "forked" | "abandoned" | "expired";
  currentStep: SurveyQuestionKey | "done";
  answers: SurveyAnswers;
  templateId: string | null;
}

export interface StartSurveyInput {
  groupId?: string;
  appUserId?: string;
  startedByUserId: string;
}

export async function startOrResumeSurvey(_input: StartSurveyInput): Promise<SurveySession> {
  throw new Error("not implemented — see design/trip-generation.md");
}

export async function recordAnswer(
  _sessionId: string,
  _questionKey: SurveyQuestionKey,
  _value: unknown
): Promise<SurveySession> {
  throw new Error("not implemented — see design/trip-generation.md");
}

export async function abandonSurvey(_sessionId: string): Promise<void> {
  throw new Error("not implemented — see design/trip-generation.md");
}

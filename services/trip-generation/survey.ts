// ─────────────────────────────────────────────────────────────────────────────
// Survey state machine — reads/writes trip_survey_sessions.
//
// Callers:
//   • bot/commands/plan.ts (group /plan entry)
//   • services/event-processor.ts handlePostback (survey| branch)
//   • app/api/app/trips/generate/route.ts (web wizard submit)
//
// All public functions are idempotent on duplicate taps: the postback branch
// validates current_step before applying, and recordAnswer no-ops if the
// session is no longer in_progress. See design/trip-generation.md.
// ─────────────────────────────────────────────────────────────────────────────

import { createAdminClient } from "@/lib/db";
import {
  SURVEY_STEP_ORDER,
  type SurveyAnswers,
  type SurveyQuestionKey,
} from "./index";

export interface SurveySession {
  id: string;
  status: "in_progress" | "generated" | "forked" | "abandoned" | "expired";
  currentStep: SurveyQuestionKey | "done";
  answers: SurveyAnswers;
  templateId: string | null;
  groupId: string | null;
  appUserId: string | null;
  startedByUserId: string;
  expiresAt: string;
}

export interface StartSurveyInput {
  groupId?: string;
  appUserId?: string;
  startedByUserId: string;
}

const SESSION_TTL_MINUTES = 30;

function rowToSession(row: Record<string, unknown>): SurveySession {
  return {
    id: row.id as string,
    status: row.status as SurveySession["status"],
    currentStep: row.current_step as SurveySession["currentStep"],
    answers: (row.answers as SurveyAnswers | null) ?? {},
    templateId: (row.template_id as string | null) ?? null,
    groupId: (row.group_id as string | null) ?? null,
    appUserId: (row.app_user_id as string | null) ?? null,
    startedByUserId: row.started_by_user_id as string,
    expiresAt: row.expires_at as string,
  };
}

/**
 * Idle in-progress sessions past `expires_at` are marked `expired`. Called
 * opportunistically at the top of each /plan invocation; cheap because the
 * partial index on (expires_at) where status='in_progress' is narrow.
 */
async function sweepExpired(): Promise<void> {
  const db = createAdminClient();
  await db
    .from("trip_survey_sessions")
    .update({ status: "expired" })
    .lt("expires_at", new Date().toISOString())
    .eq("status", "in_progress");
}

export async function startOrResumeSurvey(input: StartSurveyInput): Promise<SurveySession> {
  if (!!input.groupId === !!input.appUserId) {
    throw new Error("startOrResumeSurvey: exactly one of groupId / appUserId required");
  }
  await sweepExpired();
  const db = createAdminClient();

  // Resume the open one if it exists (partial unique idx guarantees ≤1 per group).
  const filter = input.groupId
    ? { column: "group_id", value: input.groupId }
    : { column: "app_user_id", value: input.appUserId! };

  const { data: existing } = await db
    .from("trip_survey_sessions")
    .select("*")
    .eq(filter.column, filter.value)
    .eq("status", "in_progress")
    .maybeSingle();
  if (existing) return rowToSession(existing as Record<string, unknown>);

  const expiresAt = new Date(Date.now() + SESSION_TTL_MINUTES * 60_000).toISOString();
  const insertRow: Record<string, unknown> = {
    started_by_user_id: input.startedByUserId,
    status: "in_progress",
    current_step: SURVEY_STEP_ORDER[0],
    answers: {},
    expires_at: expiresAt,
  };
  if (input.groupId) insertRow.group_id = input.groupId;
  if (input.appUserId) insertRow.app_user_id = input.appUserId;

  const { data, error } = await db
    .from("trip_survey_sessions")
    .insert(insertRow)
    .select("*")
    .single();
  if (error || !data) throw new Error(`startOrResumeSurvey failed: ${error?.message ?? "no row"}`);

  return rowToSession(data as Record<string, unknown>);
}

export async function getSession(sessionId: string): Promise<SurveySession | null> {
  const db = createAdminClient();
  const { data } = await db
    .from("trip_survey_sessions")
    .select("*")
    .eq("id", sessionId)
    .maybeSingle();
  return data ? rowToSession(data as Record<string, unknown>) : null;
}

/**
 * Apply an answer and advance current_step. Idempotent: if the session has
 * already advanced past `questionKey`, returns the current state without
 * re-writing — duplicate postback taps are a no-op.
 */
export async function recordAnswer(
  sessionId: string,
  questionKey: SurveyQuestionKey,
  value: unknown
): Promise<SurveySession> {
  const db = createAdminClient();
  const session = await getSession(sessionId);
  if (!session) throw new Error("recordAnswer: session not found");

  if (session.status !== "in_progress") return session;
  if (session.currentStep !== questionKey) return session;

  const validated = coerceAnswer(questionKey, value);
  const nextAnswers: SurveyAnswers = { ...session.answers, [questionKey]: validated } as SurveyAnswers;
  const nextStep = nextStepAfter(questionKey);

  const { data, error } = await db
    .from("trip_survey_sessions")
    .update({ answers: nextAnswers, current_step: nextStep })
    .eq("id", sessionId)
    .eq("current_step", questionKey) // optimistic guard — lose-the-race taps stay idempotent
    .select("*")
    .maybeSingle();
  if (error) throw new Error(`recordAnswer update failed: ${error.message}`);
  if (!data) return (await getSession(sessionId))!;

  return rowToSession(data as Record<string, unknown>);
}

export async function abandonSurvey(sessionId: string): Promise<void> {
  const db = createAdminClient();
  await db
    .from("trip_survey_sessions")
    .update({ status: "abandoned" })
    .eq("id", sessionId)
    .eq("status", "in_progress");
}

/**
 * Stamp the survey with the generated template so a later fork postback can
 * resolve the slug without re-running the generator.
 */
export async function markGenerated(sessionId: string, templateId: string): Promise<void> {
  const db = createAdminClient();
  await db
    .from("trip_survey_sessions")
    .update({ status: "generated", template_id: templateId })
    .eq("id", sessionId);
}

export async function markForked(sessionId: string): Promise<void> {
  const db = createAdminClient();
  await db
    .from("trip_survey_sessions")
    .update({ status: "forked" })
    .eq("id", sessionId);
}

// ─── Per-question validation ────────────────────────────────────────────────
// Postback values come in as strings; the survey owns coercion + bounds so
// the generator can trust its inputs.

function coerceAnswer(key: SurveyQuestionKey, raw: unknown): unknown {
  switch (key) {
    case "destination":
      if (raw === "skip" || raw === null) return null;
      if (typeof raw !== "string" || raw.trim().length === 0) {
        throw new Error("destination must be a non-empty string or 'skip'");
      }
      return raw.trim().slice(0, 120);

    case "duration_days": {
      const n = typeof raw === "number" ? raw : parseInt(String(raw), 10);
      if (!Number.isInteger(n) || n < 1 || n > 30) throw new Error("duration_days must be 1–30");
      return n;
    }

    case "party":
      if (!["solo", "couple", "family", "friends"].includes(String(raw))) {
        throw new Error("party must be solo|couple|family|friends");
      }
      return raw;

    case "party_size": {
      const n = typeof raw === "number" ? raw : parseInt(String(raw), 10);
      if (!Number.isInteger(n) || n < 1 || n > 20) throw new Error("party_size must be 1–20");
      return n;
    }

    case "budget_tier":
      if (!["shoestring", "mid", "luxury"].includes(String(raw))) {
        throw new Error("budget_tier must be shoestring|mid|luxury");
      }
      return raw;

    case "vibe": {
      const allowed = ["relaxed", "adventure", "culture", "foodie", "nightlife", "nature"];
      const arr = Array.isArray(raw)
        ? raw
        : String(raw)
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
      const clean = arr.filter((v) => allowed.includes(String(v))).slice(0, 3);
      if (clean.length === 0) throw new Error("vibe must select 1–3 from the allowed set");
      return clean;
    }

    case "pace":
      if (!["chill", "balanced", "packed"].includes(String(raw))) {
        throw new Error("pace must be chill|balanced|packed");
      }
      return raw;

    case "must_haves":
      if (raw === "skip" || raw === null) return null;
      return typeof raw === "string" ? raw.trim().slice(0, 500) : null;
  }
}

function nextStepAfter(key: SurveyQuestionKey): SurveyQuestionKey | "done" {
  const i = SURVEY_STEP_ORDER.indexOf(key);
  if (i < 0 || i === SURVEY_STEP_ORDER.length - 1) return "done";
  return SURVEY_STEP_ORDER[i + 1];
}

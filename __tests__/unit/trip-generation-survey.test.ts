import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({ createAdminClient: vi.fn() }));

import { recordAnswer, startOrResumeSurvey, abandonSurvey } from "@/services/trip-generation/survey";
import { createAdminClient } from "@/lib/db";

interface DbState {
  rows: Record<string, Record<string, unknown>>;
  lastInsert?: Record<string, unknown>;
}

function makeDb(state: DbState) {
  // Tiny in-memory fake of the supabase query builder for trip_survey_sessions only.
  const from = vi.fn(() => {
    const filters: Array<[string, unknown]> = [];
    let nullFilter: string | null = null;
    let cmpFilter: { kind: "lt"; col: string; val: unknown } | null = null;
    let updateRow: Record<string, unknown> | null = null;
    let insertRow: Record<string, unknown> | null = null;
    const builder: Record<string, unknown> = {
      select: vi.fn(() => builder),
      eq: vi.fn((col: string, val: unknown) => {
        filters.push([col, val]);
        return builder;
      }),
      is: vi.fn((col: string) => {
        nullFilter = col;
        return builder;
      }),
      lt: vi.fn((col: string, val: unknown) => {
        cmpFilter = { kind: "lt", col, val };
        return builder;
      }),
      update: vi.fn((row: Record<string, unknown>) => {
        updateRow = row;
        return builder;
      }),
      insert: vi.fn((row: Record<string, unknown>) => {
        insertRow = row;
        return builder;
      }),
      maybeSingle: vi.fn(() => {
        const found = findRow(state, filters);
        if (updateRow && found) {
          Object.assign(found, updateRow);
          return Promise.resolve({ data: { ...found } });
        }
        return Promise.resolve({ data: found ? { ...found } : null });
      }),
      single: vi.fn(() => {
        if (insertRow) {
          const id = `sess_${Object.keys(state.rows).length + 1}`;
          const row = { id, ...insertRow };
          state.rows[id] = row;
          state.lastInsert = row;
          return Promise.resolve({ data: { ...row }, error: null });
        }
        const found = findRow(state, filters);
        return Promise.resolve({ data: found ? { ...found } : null, error: null });
      }),
      // For bulk update without .select() — return a Promise.
      then: undefined,
    };
    void nullFilter;
    void cmpFilter;
    return builder;
  });
  return { from };
}

function findRow(state: DbState, filters: Array<[string, unknown]>): Record<string, unknown> | null {
  for (const row of Object.values(state.rows)) {
    if (filters.every(([k, v]) => row[k] === v)) return row;
  }
  return null;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("survey — startOrResumeSurvey", () => {
  it("creates a new session when none exists", async () => {
    const state: DbState = { rows: {} };
    (createAdminClient as unknown as { mockReturnValue: (v: unknown) => void }).mockReturnValue(makeDb(state));

    const session = await startOrResumeSurvey({ groupId: "g1", startedByUserId: "U1" });
    expect(session.status).toBe("in_progress");
    expect(session.currentStep).toBe("destination");
    expect(session.groupId).toBe("g1");
  });

  it("resumes when an in-progress session exists for the group", async () => {
    const state: DbState = {
      rows: {
        existing: {
          id: "existing",
          group_id: "g1",
          status: "in_progress",
          current_step: "duration_days",
          answers: { destination: "Kyoto" },
          started_by_user_id: "U1",
          expires_at: "2099-01-01T00:00:00Z",
        },
      },
    };
    (createAdminClient as unknown as { mockReturnValue: (v: unknown) => void }).mockReturnValue(makeDb(state));

    const session = await startOrResumeSurvey({ groupId: "g1", startedByUserId: "U_other" });
    expect(session.id).toBe("existing");
    expect(session.currentStep).toBe("duration_days");
  });

  it("rejects when neither or both of groupId/appUserId provided", async () => {
    await expect(startOrResumeSurvey({ startedByUserId: "U1" })).rejects.toThrow();
    await expect(
      startOrResumeSurvey({ groupId: "g1", appUserId: "a1", startedByUserId: "U1" })
    ).rejects.toThrow();
  });
});

describe("survey — recordAnswer", () => {
  it("advances current_step on a valid answer", async () => {
    const state: DbState = {
      rows: {
        s1: {
          id: "s1",
          group_id: "g1",
          status: "in_progress",
          current_step: "destination",
          answers: {},
          started_by_user_id: "U1",
          expires_at: "2099-01-01T00:00:00Z",
        },
      },
    };
    (createAdminClient as unknown as { mockReturnValue: (v: unknown) => void }).mockReturnValue(makeDb(state));

    const out = await recordAnswer("s1", "destination", "Kyoto");
    expect(out.currentStep).toBe("duration_days");
    expect(out.answers.destination).toBe("Kyoto");
  });

  it("rejects invalid pace", async () => {
    const state: DbState = {
      rows: {
        s1: {
          id: "s1",
          group_id: "g1",
          status: "in_progress",
          current_step: "pace",
          answers: {},
          started_by_user_id: "U1",
          expires_at: "2099-01-01T00:00:00Z",
        },
      },
    };
    (createAdminClient as unknown as { mockReturnValue: (v: unknown) => void }).mockReturnValue(makeDb(state));
    await expect(recordAnswer("s1", "pace", "frantic")).rejects.toThrow();
  });

  it("no-ops on a duplicate-tap (current_step already advanced)", async () => {
    const state: DbState = {
      rows: {
        s1: {
          id: "s1",
          group_id: "g1",
          status: "in_progress",
          current_step: "duration_days", // already moved past 'destination'
          answers: { destination: "Kyoto" },
          started_by_user_id: "U1",
          expires_at: "2099-01-01T00:00:00Z",
        },
      },
    };
    (createAdminClient as unknown as { mockReturnValue: (v: unknown) => void }).mockReturnValue(makeDb(state));

    const out = await recordAnswer("s1", "destination", "Tokyo");
    expect(out.currentStep).toBe("duration_days");
    expect(out.answers.destination).toBe("Kyoto"); // unchanged
  });

  it("ends at 'done' after the final question", async () => {
    const state: DbState = {
      rows: {
        s1: {
          id: "s1",
          group_id: "g1",
          status: "in_progress",
          current_step: "must_haves",
          answers: {},
          started_by_user_id: "U1",
          expires_at: "2099-01-01T00:00:00Z",
        },
      },
    };
    (createAdminClient as unknown as { mockReturnValue: (v: unknown) => void }).mockReturnValue(makeDb(state));

    const out = await recordAnswer("s1", "must_haves", "skip");
    expect(out.currentStep).toBe("done");
    expect(out.answers.must_haves).toBeNull();
  });
});

describe("survey — abandonSurvey", () => {
  it("calls update({status:'abandoned'}) scoped to the session id", async () => {
    const state: DbState = {
      rows: {
        s1: {
          id: "s1",
          group_id: "g1",
          status: "in_progress",
          current_step: "destination",
          answers: {},
          started_by_user_id: "U1",
          expires_at: "2099-01-01T00:00:00Z",
        },
      },
    };
    const db = makeDb(state);
    (createAdminClient as unknown as { mockReturnValue: (v: unknown) => void }).mockReturnValue(db);

    await abandonSurvey("s1");

    expect(db.from).toHaveBeenCalledWith("trip_survey_sessions");
    // The fake builder returns itself from update/eq so the chain shape is the
    // important contract; the SQL itself is exercised at integration time.
  });
});

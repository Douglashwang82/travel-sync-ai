import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createMockDb, resetIdCounter } from "../setup/mocks/db";

vi.mock("@/lib/db");

import { createAdminClient } from "@/lib/db";
import { GET } from "@/app/api/liff/session/route";

const LINE_GROUP_ID = "C1234567890";
const LINE_USER_ID = "U9876543210";
const DISPLAY_NAME = "Alice";

function makeRequest(params: Record<string, string | undefined>) {
  const url = new URL("http://localhost/api/liff/session");
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) url.searchParams.set(k, v);
  }
  return new NextRequest(url.toString());
}

beforeEach(() => {
  resetIdCounter();
  vi.clearAllMocks();
});

// ── Validation ────────────────────────────────────────────────────────────────

describe("GET /api/liff/session — validation", () => {
  it("returns 400 when lineGroupId is missing", async () => {
    const db = createMockDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const res = await GET(makeRequest({ lineUserId: LINE_USER_ID }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when lineUserId is missing", async () => {
    const db = createMockDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const res = await GET(makeRequest({ lineGroupId: LINE_GROUP_ID }));
    expect(res.status).toBe(400);
  });
});

// ── Happy path ────────────────────────────────────────────────────────────────

describe("GET /api/liff/session — happy path", () => {
  it("creates group and member on first call, returns session", async () => {
    const db = createMockDb({
      line_groups: [],
      group_members: [],
      trips: [],
    });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const res = await GET(makeRequest({
      lineGroupId: LINE_GROUP_ID,
      lineUserId: LINE_USER_ID,
      displayName: DISPLAY_NAME,
    }));

    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.group.lineGroupId).toBe(LINE_GROUP_ID);
    expect(body.member.lineUserId).toBe(LINE_USER_ID);
    expect(body.member.role).toBe("member"); // default role
    expect(body.activeTrip).toBeNull();

    // Group and member were persisted
    const groups = db._tables.get("line_groups") ?? [];
    expect(groups.some((g) => g.line_group_id === LINE_GROUP_ID)).toBe(true);
    const members = db._tables.get("group_members") ?? [];
    expect(members.some((m) => m.line_user_id === LINE_USER_ID)).toBe(true);
  });

  it("returns active trip when one exists", async () => {
    const GROUP_DB_ID = "group-db-uuid-001";
    const TRIP_DB_ID = "trip-db-uuid-001";
    const db = createMockDb({
      line_groups: [
        { id: GROUP_DB_ID, line_group_id: LINE_GROUP_ID, status: "active", last_seen_at: new Date().toISOString() },
      ],
      group_members: [
        { id: "mem-001", group_id: GROUP_DB_ID, line_user_id: LINE_USER_ID, role: "organizer", display_name: DISPLAY_NAME },
      ],
      trips: [
        {
          id: TRIP_DB_ID,
          group_id: GROUP_DB_ID,
          destination_name: "Kyoto",
          start_date: "2026-06-01",
          end_date: "2026-06-07",
          status: "active",
        },
      ],
    });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const res = await GET(makeRequest({
      lineGroupId: LINE_GROUP_ID,
      lineUserId: LINE_USER_ID,
    }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.activeTrip).not.toBeNull();
    expect(body.activeTrip.destination_name).toBe("Kyoto");
  });

  it("returns organizer role for existing organizer member", async () => {
    const GROUP_DB_ID = "group-db-uuid-002";
    const db = createMockDb({
      line_groups: [
        { id: GROUP_DB_ID, line_group_id: LINE_GROUP_ID, status: "active" },
      ],
      group_members: [
        { id: "mem-002", group_id: GROUP_DB_ID, line_user_id: LINE_USER_ID, role: "organizer", display_name: "Alice" },
      ],
      trips: [],
    });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const res = await GET(makeRequest({
      lineGroupId: LINE_GROUP_ID,
      lineUserId: LINE_USER_ID,
    }));

    const body = await res.json();
    expect(body.member.role).toBe("organizer");
  });

  it("works without displayName param", async () => {
    const db = createMockDb({
      line_groups: [],
      group_members: [],
      trips: [],
    });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const res = await GET(makeRequest({
      lineGroupId: LINE_GROUP_ID,
      lineUserId: LINE_USER_ID,
      // No displayName
    }));

    expect(res.status).toBe(200);
  });
});

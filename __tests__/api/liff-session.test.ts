import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createMockDb, resetIdCounter } from "../setup/mocks/db";

vi.mock("@/lib/db");
vi.mock("@/lib/liff-server", () => ({
  authenticateLiffRequest: vi.fn().mockResolvedValue({ ok: true, lineUserId: "U9876543210" }),
}));

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
  it("returns 404 when lineGroupId is omitted and the user has no group memberships", async () => {
    const db = createMockDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const res = await GET(makeRequest({ lineUserId: LINE_USER_ID }));
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe("NOT_FOUND");
  });

  it("accepts requests without lineUserId query param because it comes from the LIFF token", async () => {
    const db = createMockDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const res = await GET(makeRequest({ lineGroupId: LINE_GROUP_ID }));
    expect(res.status).toBe(200);
  });
});

// ── Private chat / browser fallback ───────────────────────────────────────────

describe("GET /api/liff/session — private chat / browser fallback", () => {
  it("ignores fake 1:1 'U…' line_groups when resolving the user's group", async () => {
    const REAL_GROUP_ID = "group-real-001";
    const FAKE_DM_GROUP_ID = "group-fake-dm-001";
    const TRIP_DB_ID = "trip-real-001";
    const db = createMockDb({
      line_groups: [
        // Fake 1:1 chat "group" the webhook upserts when the user DMs the bot.
        // Has the most recent last_seen_at — without filtering it would win.
        {
          id: FAKE_DM_GROUP_ID,
          line_group_id: LINE_USER_ID,
          status: "active",
          name: null,
          last_seen_at: "2026-04-25T10:00:00.000Z",
        },
        // Real group with the active trip.
        {
          id: REAL_GROUP_ID,
          line_group_id: "C9999999999",
          status: "active",
          name: "Trip Crew",
          last_seen_at: "2026-04-20T10:00:00.000Z",
        },
      ],
      group_members: [
        { id: "mem-real", group_id: REAL_GROUP_ID, line_user_id: LINE_USER_ID, role: "organizer" },
      ],
      trips: [
        {
          id: TRIP_DB_ID,
          group_id: REAL_GROUP_ID,
          destination_name: "Osaka",
          status: "active",
          created_at: "2026-04-19T00:00:00.000Z",
        },
      ],
    });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    // No lineGroupId — simulates LIFF opened from the rich menu in the bot DM.
    const res = await GET(makeRequest({ lineUserId: LINE_USER_ID }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.group.id).toBe(REAL_GROUP_ID);
    expect(body.group.lineGroupId).toBe("C9999999999");
    expect(body.activeTrip).not.toBeNull();
    expect(body.activeTrip.id).toBe(TRIP_DB_ID);
  });

  it("picks the most recently active group when the user belongs to several", async () => {
    const STALE_GROUP_ID = "group-stale-001";
    const RECENT_GROUP_ID = "group-recent-001";
    const RECENT_TRIP_ID = "trip-recent-001";
    const db = createMockDb({
      line_groups: [
        {
          id: STALE_GROUP_ID,
          line_group_id: "C0000000001",
          status: "active",
          last_seen_at: "2026-01-01T00:00:00.000Z",
        },
        {
          id: RECENT_GROUP_ID,
          line_group_id: "C0000000002",
          status: "active",
          last_seen_at: "2026-04-20T00:00:00.000Z",
        },
      ],
      group_members: [
        { id: "mem-stale", group_id: STALE_GROUP_ID, line_user_id: LINE_USER_ID, role: "member" },
        { id: "mem-recent", group_id: RECENT_GROUP_ID, line_user_id: LINE_USER_ID, role: "organizer" },
      ],
      trips: [
        // Only the recently-active group has an active trip.
        {
          id: RECENT_TRIP_ID,
          group_id: RECENT_GROUP_ID,
          destination_name: "Tokyo",
          status: "active",
          created_at: "2026-04-15T00:00:00.000Z",
        },
      ],
    });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const res = await GET(makeRequest({ lineUserId: LINE_USER_ID }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.group.id).toBe(RECENT_GROUP_ID);
    expect(body.activeTrip?.id).toBe(RECENT_TRIP_ID);
  });

  it("ignores groups marked removed when falling back", async () => {
    const REMOVED_GROUP_ID = "group-removed-001";
    const ACTIVE_GROUP_ID = "group-active-001";
    const db = createMockDb({
      line_groups: [
        {
          id: REMOVED_GROUP_ID,
          line_group_id: "C0000000003",
          status: "removed",
          last_seen_at: "2026-04-25T00:00:00.000Z",
        },
        {
          id: ACTIVE_GROUP_ID,
          line_group_id: "C0000000004",
          status: "active",
          last_seen_at: "2026-04-10T00:00:00.000Z",
        },
      ],
      group_members: [
        { id: "mem-removed", group_id: REMOVED_GROUP_ID, line_user_id: LINE_USER_ID, role: "member" },
        { id: "mem-active", group_id: ACTIVE_GROUP_ID, line_user_id: LINE_USER_ID, role: "member" },
      ],
      trips: [],
    });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const res = await GET(makeRequest({ lineUserId: LINE_USER_ID }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.group.id).toBe(ACTIVE_GROUP_ID);
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
          destination_place_id: "place-kyoto",
          destination_formatted_address: "Kyoto, Japan",
          destination_google_maps_url: "https://maps.google.com/?cid=789",
          destination_lat: 35.0116,
          destination_lng: 135.7681,
          destination_timezone: "Asia/Tokyo",
          destination_source_last_synced_at: "2026-04-13T18:00:00.000Z",
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
    expect(body.activeTrip.destination_place_id).toBe("place-kyoto");
    expect(body.activeTrip.destination_formatted_address).toBe("Kyoto, Japan");
    expect(body.activeTrip.destination_google_maps_url).toBe("https://maps.google.com/?cid=789");
    expect(body.activeTrip.destination_lat).toBe(35.0116);
    expect(body.activeTrip.destination_lng).toBe(135.7681);
    expect(body.activeTrip.destination_timezone).toBe("Asia/Tokyo");
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

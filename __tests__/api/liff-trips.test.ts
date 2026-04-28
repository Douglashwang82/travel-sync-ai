import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createMockDb, resetIdCounter } from "../setup/mocks/db";

vi.mock("@/lib/db");
vi.mock("@/lib/liff-server", () => ({
  authenticateLiffRequest: vi.fn().mockResolvedValue({ ok: true, lineUserId: "U_USER_001" }),
}));

import { createAdminClient } from "@/lib/db";
import { GET } from "@/app/api/liff/trips/route";

function makeRequest() {
  return new NextRequest("http://localhost/api/liff/trips");
}

beforeEach(() => {
  resetIdCounter();
  vi.clearAllMocks();
});

describe("GET /api/liff/trips", () => {
  it("returns an empty list when the user has no memberships", async () => {
    const db = createMockDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ trips: [] });
  });

  it("returns all trips across the user's real, active groups with item counts", async () => {
    const GROUP_A = "group-a";
    const GROUP_B = "group-b";
    const TRIP_A = "trip-a";
    const TRIP_B = "trip-b";
    const TRIP_PAST = "trip-past";
    const db = createMockDb({
      line_groups: [
        { id: GROUP_A, line_group_id: "C_AAA", name: "Tokyo Crew", status: "active" },
        { id: GROUP_B, line_group_id: "C_BBB", name: "Osaka Crew", status: "active" },
      ],
      group_members: [
        { id: "m1", group_id: GROUP_A, line_user_id: "U_USER_001", role: "organizer" },
        { id: "m2", group_id: GROUP_B, line_user_id: "U_USER_001", role: "member" },
      ],
      trips: [
        {
          id: TRIP_A,
          group_id: GROUP_A,
          destination_name: "Tokyo",
          start_date: "2026-06-01",
          end_date: "2026-06-07",
          status: "active",
          created_at: "2026-04-15T00:00:00Z",
        },
        {
          id: TRIP_B,
          group_id: GROUP_B,
          destination_name: "Osaka",
          start_date: null,
          end_date: null,
          status: "draft",
          created_at: "2026-04-20T00:00:00Z",
        },
        {
          id: TRIP_PAST,
          group_id: GROUP_A,
          destination_name: "Sapporo",
          start_date: "2026-01-01",
          end_date: "2026-01-05",
          status: "completed",
          created_at: "2026-01-10T00:00:00Z",
        },
      ],
      trip_items: [
        { id: "i1", trip_id: TRIP_A },
        { id: "i2", trip_id: TRIP_A },
        { id: "i3", trip_id: TRIP_A },
        { id: "i4", trip_id: TRIP_B },
      ],
    });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.trips).toHaveLength(3);
    // Ordered by created_at desc
    expect(body.trips.map((t: { id: string }) => t.id)).toEqual([TRIP_B, TRIP_A, TRIP_PAST]);

    const tripA = body.trips.find((t: { id: string }) => t.id === TRIP_A);
    expect(tripA).toMatchObject({
      groupId: GROUP_A,
      groupName: "Tokyo Crew",
      destinationName: "Tokyo",
      status: "active",
      itemCount: 3,
    });

    const tripPast = body.trips.find((t: { id: string }) => t.id === TRIP_PAST);
    expect(tripPast.status).toBe("completed");
    expect(tripPast.itemCount).toBe(0);
  });

  it("excludes fake U… 1:1 chat groups and removed groups", async () => {
    const REAL_GROUP = "group-real";
    const FAKE_DM_GROUP = "group-dm";
    const REMOVED_GROUP = "group-removed";
    const REAL_TRIP = "trip-real";
    const db = createMockDb({
      line_groups: [
        { id: REAL_GROUP, line_group_id: "C_REAL", status: "active", name: "Real" },
        // The webhook upserts this row when the user DMs the bot.
        { id: FAKE_DM_GROUP, line_group_id: "U_USER_001", status: "active", name: null },
        { id: REMOVED_GROUP, line_group_id: "C_OLD", status: "removed", name: "Old" },
      ],
      group_members: [
        { id: "m1", group_id: REAL_GROUP, line_user_id: "U_USER_001", role: "organizer" },
        { id: "m2", group_id: FAKE_DM_GROUP, line_user_id: "U_USER_001", role: "member" },
        { id: "m3", group_id: REMOVED_GROUP, line_user_id: "U_USER_001", role: "member" },
      ],
      trips: [
        {
          id: REAL_TRIP,
          group_id: REAL_GROUP,
          destination_name: "Kyoto",
          status: "active",
          created_at: "2026-04-15T00:00:00Z",
        },
        // A trip on a removed group must not leak through.
        {
          id: "trip-removed",
          group_id: REMOVED_GROUP,
          destination_name: "Old Trip",
          status: "active",
          created_at: "2026-01-01T00:00:00Z",
        },
      ],
    });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.trips).toHaveLength(1);
    expect(body.trips[0].id).toBe(REAL_TRIP);
    expect(body.trips[0].groupName).toBe("Real");
  });

  it("ignores memberships the user has left", async () => {
    const GROUP_ID = "group-x";
    const db = createMockDb({
      line_groups: [{ id: GROUP_ID, line_group_id: "C_X", status: "active", name: "X" }],
      group_members: [
        {
          id: "m1",
          group_id: GROUP_ID,
          line_user_id: "U_USER_001",
          role: "member",
          left_at: "2026-04-01T00:00:00Z",
        },
      ],
      trips: [
        { id: "trip-x", group_id: GROUP_ID, destination_name: "X", status: "active", created_at: "2026-04-15T00:00:00Z" },
      ],
    });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    expect((await res.json()).trips).toEqual([]);
  });
});

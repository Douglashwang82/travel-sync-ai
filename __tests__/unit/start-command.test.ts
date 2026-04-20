import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockDb, resetIdCounter } from "../setup/mocks/db";

vi.mock("@/lib/db");
vi.mock("@/lib/analytics", () => ({
  track: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/services/trips/destination", () => ({
  enrichTripDestinationMetadata: vi.fn().mockResolvedValue(undefined),
}));

import { createAdminClient } from "@/lib/db";
import { handleStart } from "@/bot/commands/start";
import { enrichTripDestinationMetadata } from "@/services/trips/destination";

const ctx = {
  lineGroupId: "C123",
  dbGroupId: "group-1",
  userId: "user-1",
  replyToken: undefined,
};

describe("handleStart", () => {
  beforeEach(() => {
    resetIdCounter();
    vi.clearAllMocks();
  });

  it("creates an undecided trip when called with no arguments", async () => {
    const db = createMockDb({ trips: [], group_members: [] });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);
    const reply = vi.fn().mockResolvedValue(undefined);

    await handleStart([], ctx, reply);

    const trips = db._tables.get("trips") ?? [];
    expect(trips).toHaveLength(1);
    expect(trips[0]).toMatchObject({
      group_id: "group-1",
      destination_name: null,
      start_date: null,
      end_date: null,
      status: "active",
      created_by_user_id: "user-1",
    });

    expect(vi.mocked(enrichTripDestinationMetadata)).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith(expect.stringContaining("Trip started"));
    expect(reply).toHaveBeenCalledWith(
      expect.stringContaining("decide together")
    );
  });

  it("still records destination and dates when they are provided up-front", async () => {
    const db = createMockDb({ trips: [], group_members: [] });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);
    const reply = vi.fn().mockResolvedValue(undefined);

    await handleStart(["Osaka", "12/20-12/25"], ctx, reply);

    const trips = db._tables.get("trips") ?? [];
    expect(trips[0]).toMatchObject({
      destination_name: "Osaka",
      start_date: expect.stringMatching(/-12-20$/),
      end_date: expect.stringMatching(/-12-25$/),
      status: "active",
    });
    expect(vi.mocked(enrichTripDestinationMetadata)).toHaveBeenCalledWith(
      expect.any(String),
      "Osaka"
    );
  });

  it("refuses when a trip is already in progress", async () => {
    const db = createMockDb({
      trips: [
        {
          id: "trip-existing",
          group_id: "group-1",
          destination_name: null,
          status: "active",
        },
      ],
    });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);
    const reply = vi.fn().mockResolvedValue(undefined);

    await handleStart([], ctx, reply);

    expect(reply).toHaveBeenCalledWith(
      expect.stringContaining("already a trip in progress")
    );
    expect((db._tables.get("trips") ?? []).length).toBe(1);
  });
});

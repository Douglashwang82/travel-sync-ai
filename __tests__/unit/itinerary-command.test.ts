import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockDb, resetIdCounter } from "../setup/mocks/db";

vi.mock("@/lib/db");

import { createAdminClient } from "@/lib/db";
import { handleItinerary } from "@/bot/commands/itinerary";

const ctx = {
  lineGroupId: "C123",
  dbGroupId: "group-1",
  userId: "user-1",
  replyToken: undefined,
};

const BASE_TRIP = {
  id: "trip-1",
  group_id: "group-1",
  destination_name: "Tokyo",
  start_date: "2026-07-15",
  end_date: "2026-07-17",
  status: "active",
  day_notes: {
    "2026-07-15": { note: "Arrival day" },
  },
};

describe("handleItinerary", () => {
  beforeEach(() => {
    resetIdCounter();
    vi.clearAllMocks();
  });

  it("returns the whole confirmed itinerary when no date is provided", async () => {
    const db = createMockDb({
      trips: [BASE_TRIP],
      trip_items: [
        {
          id: "item-1",
          trip_id: "trip-1",
          title: "Hotel check-in",
          item_type: "hotel",
          stage: "confirmed",
          source: "manual",
          deadline_at: "2026-07-15T15:00:00Z",
          booking_status: "booked",
          booking_ref: "ABC123",
          metadata: { type: "hotel" },
          trip_item_options: null,
        },
        {
          id: "item-2",
          trip_id: "trip-1",
          title: "Dinner",
          item_type: "restaurant",
          stage: "confirmed",
          source: "manual",
          deadline_at: "2026-07-16T19:00:00Z",
          booking_status: "not_required",
          metadata: { type: "restaurant" },
          trip_item_options: { id: "opt-1", name: "Ramen Shop Osaka" },
        },
      ],
    });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);
    const reply = vi.fn().mockResolvedValue(undefined);

    await handleItinerary([], ctx, reply);

    const message = reply.mock.calls[0][0] as string;
    expect(message).toContain("Itinerary: Tokyo");
    expect(message).toContain("2026-07-15");
    expect(message).toContain("Note: Arrival day");
    expect(message).toContain("Hotel check-in ref ABC123");
    expect(message).toContain("2026-07-16");
    expect(message).toContain("Dinner: Ramen Shop Osaka");
  });

  it("filters the itinerary when a date is provided", async () => {
    const db = createMockDb({
      trips: [BASE_TRIP],
      trip_items: [
        {
          id: "item-1",
          trip_id: "trip-1",
          title: "Hotel check-in",
          item_type: "hotel",
          stage: "confirmed",
          source: "manual",
          deadline_at: "2026-07-15T15:00:00Z",
          booking_status: "booked",
          metadata: { type: "hotel" },
        },
        {
          id: "item-2",
          trip_id: "trip-1",
          title: "Dinner",
          item_type: "restaurant",
          stage: "confirmed",
          source: "manual",
          deadline_at: "2026-07-16T19:00:00Z",
          booking_status: "not_required",
          metadata: { type: "restaurant" },
        },
      ],
    });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);
    const reply = vi.fn().mockResolvedValue(undefined);

    await handleItinerary(["7/15"], ctx, reply);

    const message = reply.mock.calls[0][0] as string;
    expect(message).toContain("Itinerary for 2026-07-15");
    expect(message).toContain("Hotel check-in");
    expect(message).not.toContain("Dinner");
  });

  it("shows an empty day message when the date has no confirmed plans", async () => {
    const db = createMockDb({
      trips: [BASE_TRIP],
      trip_items: [],
    });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);
    const reply = vi.fn().mockResolvedValue(undefined);

    await handleItinerary(["2026-07-18"], ctx, reply);

    expect(reply).toHaveBeenCalledWith(expect.stringContaining("No confirmed plans"));
  });
});

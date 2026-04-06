/**
 * startDecision integration tests.
 *
 * Focuses on the zero-candidates path introduced by the Places API fix:
 *   - Item must NOT be moved to pending when no candidates are found.
 *   - The correct user-facing message is pushed based on errorKind.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb, resetIdCounter } from "../setup/mocks/db";

vi.mock("@/lib/db");
vi.mock("@/lib/analytics", () => ({ track: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/line", () => ({
  pushText: vi.fn().mockResolvedValue(undefined),
  pushFlex: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/services/decisions/places");

import { createAdminClient } from "@/lib/db";
import { pushText } from "@/lib/line";
import { searchPlaces } from "@/services/decisions/places";
import { startDecision } from "@/services/decisions";

const GROUP_ID = "group-dec-001";
const TRIP_ID = "trip-dec-001";
const ITEM_ID = "item-dec-001";

function seedDb() {
  return createMockDb({
    trips: [{ id: TRIP_ID, group_id: GROUP_ID, destination_name: "Tokyo", status: "active" }],
    trip_items: [
      {
        id: ITEM_ID,
        trip_id: TRIP_ID,
        title: "Hotel booking",
        stage: "todo",
        item_type: "hotel",
        source: "command",
        deadline_at: null,
        confirmed_option_id: null,
        tie_extension_count: 0,
      },
    ],
    trip_item_options: [],
    votes: [],
    group_members: [
      { id: "m0", group_id: GROUP_ID, line_user_id: "user-0", left_at: null, role: "organizer" },
    ],
  });
}

const INPUT = {
  itemId: ITEM_ID,
  tripId: TRIP_ID,
  groupId: GROUP_ID,
  lineGroupId: "C-line-group",
  destination: "Tokyo",
};

beforeEach(() => {
  resetIdCounter();
  vi.clearAllMocks();
});

// ── no_results path ───────────────────────────────────────────────────────────

describe("startDecision — no_results from Places API", () => {
  it("does NOT move item to pending", async () => {
    const db = seedDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);
    vi.mocked(searchPlaces).mockResolvedValue({ candidates: [], errorKind: "no_results" });

    await startDecision(INPUT);

    const items = db._tables.get("trip_items") ?? [];
    const item = items.find((r) => r.id === ITEM_ID);
    expect(item?.stage).toBe("todo"); // must still be todo
  });

  it("pushes a 'add options manually' message with the /vote retry hint", async () => {
    const db = seedDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);
    vi.mocked(searchPlaces).mockResolvedValue({ candidates: [], errorKind: "no_results" });

    await startDecision(INPUT);

    expect(pushText).toHaveBeenCalledOnce();
    const [, message] = vi.mocked(pushText).mock.calls[0];
    expect(message).toMatch(/no places found/i);
    expect(message).toContain("/vote");
  });
});

// ── network_error path ────────────────────────────────────────────────────────

describe("startDecision — network_error from Places API", () => {
  it("does NOT move item to pending", async () => {
    const db = seedDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);
    vi.mocked(searchPlaces).mockResolvedValue({ candidates: [], errorKind: "network_error" });

    await startDecision(INPUT);

    const items = db._tables.get("trip_items") ?? [];
    const item = items.find((r) => r.id === ITEM_ID);
    expect(item?.stage).toBe("todo");
  });

  it("pushes a 'try again' message with the /vote retry hint", async () => {
    const db = seedDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);
    vi.mocked(searchPlaces).mockResolvedValue({ candidates: [], errorKind: "network_error" });

    await startDecision(INPUT);

    expect(pushText).toHaveBeenCalledOnce();
    const [, message] = vi.mocked(pushText).mock.calls[0];
    expect(message).toMatch(/couldn't reach/i);
    expect(message).toContain("/vote");
  });

  it("no_results and network_error messages are distinct", async () => {
    const db1 = seedDb();
    vi.mocked(createAdminClient).mockReturnValue(db1 as ReturnType<typeof createAdminClient>);
    vi.mocked(searchPlaces).mockResolvedValue({ candidates: [], errorKind: "no_results" });
    await startDecision(INPUT);
    const noResultsMsg = vi.mocked(pushText).mock.calls[0][1];

    vi.clearAllMocks();
    const db2 = seedDb();
    vi.mocked(createAdminClient).mockReturnValue(db2 as ReturnType<typeof createAdminClient>);
    vi.mocked(searchPlaces).mockResolvedValue({ candidates: [], errorKind: "network_error" });
    await startDecision(INPUT);
    const networkErrorMsg = vi.mocked(pushText).mock.calls[0][1];

    expect(noResultsMsg).not.toBe(networkErrorMsg);
  });
});

// ── happy path: candidates found ──────────────────────────────────────────────

describe("startDecision — candidates found", () => {
  it("moves item to pending and inserts options", async () => {
    const db = seedDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);
    vi.mocked(searchPlaces).mockResolvedValue({
      candidates: [
        {
          name: "Park Hyatt Tokyo",
          address: "3-7-1-2 Nishi Shinjuku",
          rating: 4.6,
          priceLevel: "$$$",
          photoUrl: "https://example.com/photo.jpg",
          placeId: "ChIJplace1",
          bookingUrl: null,
        },
      ],
      errorKind: null,
    });

    await startDecision(INPUT);

    const items = db._tables.get("trip_items") ?? [];
    const item = items.find((r) => r.id === ITEM_ID);
    expect(item?.stage).toBe("pending");
    expect(item?.deadline_at).not.toBeNull();

    const options = db._tables.get("trip_item_options") ?? [];
    expect(options).toHaveLength(1);
    expect(options[0].name).toBe("Park Hyatt Tokyo");
    expect(options[0].trip_item_id).toBe(ITEM_ID);
  });

  it("pushes both a text announcement and a flex carousel", async () => {
    const { pushFlex } = await import("@/lib/line");
    const db = seedDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);
    vi.mocked(searchPlaces).mockResolvedValue({
      candidates: [
        {
          name: "Hotel A",
          address: null,
          rating: null,
          priceLevel: null,
          photoUrl: null,
          placeId: "place-a",
          bookingUrl: null,
        },
      ],
      errorKind: null,
    });

    await startDecision(INPUT);

    expect(pushText).toHaveBeenCalledOnce();
    expect(pushFlex).toHaveBeenCalledOnce();
  });

  it("rejects the flow if item is already pending (not todo)", async () => {
    const db = seedDb();
    db._tables.set("trip_items", [
      { ...db._tables.get("trip_items")![0], stage: "pending" },
    ]);
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);
    vi.mocked(searchPlaces).mockResolvedValue({ candidates: [], errorKind: null });

    await startDecision(INPUT);

    // Should push an "already pending" message, not start a new vote
    expect(pushText).toHaveBeenCalledOnce();
    const [, msg] = vi.mocked(pushText).mock.calls[0];
    expect(msg).toMatch(/already pending/i);
  });
});

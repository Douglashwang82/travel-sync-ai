import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createMockDb, resetIdCounter } from "../setup/mocks/db";

vi.mock("@/lib/db");
// Mock services that make external calls
vi.mock("@/services/vote");
vi.mock("@/services/decisions");
vi.mock("@/lib/liff-auth");

import { createAdminClient } from "@/lib/db";
import { GET } from "@/app/api/liff/votes/route";

const TRIP_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ITEM_ID_1 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ITEM_ID_2 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OPT_ID_1A = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const OPT_ID_1B = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const OPT_ID_2A = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const USER_A = "Uaaaaaaaaaa";
const USER_B = "Ubbbbbbbbbb";

function makeRequest(params: Record<string, string>) {
  const qs = new URLSearchParams(params).toString();
  return new NextRequest(`http://localhost/api/liff/votes?${qs}`);
}

beforeEach(() => {
  resetIdCounter();
  vi.clearAllMocks();
});

// ── Validation ────────────────────────────────────────────────────────────────

describe("GET /api/liff/votes — validation", () => {
  it("returns 400 when tripId is missing", async () => {
    const db = createMockDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const res = await GET(makeRequest({}));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when tripId is not a valid UUID", async () => {
    const db = createMockDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const res = await GET(makeRequest({ tripId: "bad-id" }));
    expect(res.status).toBe(400);
  });
});

// ── Empty state ───────────────────────────────────────────────────────────────

describe("GET /api/liff/votes — empty state", () => {
  it("returns empty votes array when no pending items", async () => {
    const db = createMockDb({
      trip_items: [
        { id: ITEM_ID_1, trip_id: TRIP_ID, title: "Hotel", item_type: "hotel", stage: "confirmed" },
      ],
    });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const res = await GET(makeRequest({ tripId: TRIP_ID }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.votes).toHaveLength(0);
  });

  it("returns empty array when trip has no items at all", async () => {
    const db = createMockDb({ trip_items: [] });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const res = await GET(makeRequest({ tripId: TRIP_ID }));
    expect(res.status).toBe(200);
    expect((await res.json()).votes).toHaveLength(0);
  });
});

// ── Vote data ────────────────────────────────────────────────────────────────

describe("GET /api/liff/votes — with pending items", () => {
  const seedData = {
    trip_items: [
      {
        id: ITEM_ID_1,
        trip_id: TRIP_ID,
        title: "Hotel",
        item_type: "hotel",
        stage: "pending",
        deadline_at: "2026-05-10T12:00:00Z",
        created_at: "2026-04-01T00:00:00Z",
      },
      {
        id: ITEM_ID_2,
        trip_id: TRIP_ID,
        title: "Dinner spot",
        item_type: "restaurant",
        stage: "pending",
        deadline_at: null,
        created_at: "2026-04-02T00:00:00Z",
      },
    ],
    trip_item_options: [
      {
        id: OPT_ID_1A,
        trip_item_id: ITEM_ID_1,
        name: "Hotel Granvia",
        image_url: "https://example.com/img1.jpg",
        rating: 4.5,
        price_level: "$$$",
        booking_url: "https://booking.com/hotel-granvia",
      },
      {
        id: OPT_ID_1B,
        trip_item_id: ITEM_ID_1,
        name: "APA Hotel Namba",
        image_url: null,
        rating: 4.0,
        price_level: "$$",
        booking_url: null,
      },
      {
        id: OPT_ID_2A,
        trip_item_id: ITEM_ID_2,
        name: "Nanbantei",
        image_url: null,
        rating: null,
        price_level: null,
        booking_url: null,
      },
    ],
    votes: [
      { trip_item_id: ITEM_ID_1, option_id: OPT_ID_1A, line_user_id: USER_A },
      { trip_item_id: ITEM_ID_1, option_id: OPT_ID_1A, line_user_id: USER_B },
      { trip_item_id: ITEM_ID_1, option_id: OPT_ID_1B, line_user_id: "U_c" },
    ],
  };

  it("returns all pending items with options and tallies", async () => {
    const db = createMockDb(seedData);
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const res = await GET(makeRequest({ tripId: TRIP_ID }));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.votes).toHaveLength(2);

    const hotelVote = body.votes.find((v: { item: { title: string } }) => v.item.title === "Hotel");
    expect(hotelVote).toBeDefined();
    expect(hotelVote.options).toHaveLength(2);
    expect(hotelVote.totalVotes).toBe(3);

    const granviaOpt = hotelVote.options.find((o: { name: string }) => o.name === "Hotel Granvia");
    expect(granviaOpt.voteCount).toBe(2);
    expect(granviaOpt.rating).toBe(4.5);
    expect(granviaOpt.price_level).toBe("$$$");

    const apaOpt = hotelVote.options.find((o: { name: string }) => o.name === "APA Hotel Namba");
    expect(apaOpt.voteCount).toBe(1);

    // Dinner item has no votes yet
    const dinnerVote = body.votes.find((v: { item: { title: string } }) => v.item.title === "Dinner spot");
    expect(dinnerVote.totalVotes).toBe(0);
    expect(dinnerVote.myVoteOptionId).toBeNull();
  });

  it("marks the caller's voted option when lineUserId is provided", async () => {
    const db = createMockDb(seedData);
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const res = await GET(makeRequest({ tripId: TRIP_ID, lineUserId: USER_A }));
    const body = await res.json();

    const hotelVote = body.votes.find((v: { item: { title: string } }) => v.item.title === "Hotel");
    expect(hotelVote.myVoteOptionId).toBe(OPT_ID_1A);

    const granviaOpt = hotelVote.options.find((o: { id: string }) => o.id === OPT_ID_1A);
    expect(granviaOpt.votedByMe).toBe(true);

    const apaOpt = hotelVote.options.find((o: { id: string }) => o.id === OPT_ID_1B);
    expect(apaOpt.votedByMe).toBe(false);
  });

  it("does not mark any option when lineUserId is not provided", async () => {
    const db = createMockDb(seedData);
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const res = await GET(makeRequest({ tripId: TRIP_ID }));
    const body = await res.json();

    for (const vote of body.votes) {
      expect(vote.myVoteOptionId).toBeNull();
      for (const opt of vote.options) {
        expect(opt.votedByMe).toBe(false);
      }
    }
  });

  it("does not mark option when user has not voted", async () => {
    const db = createMockDb(seedData);
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const res = await GET(makeRequest({ tripId: TRIP_ID, lineUserId: "U_never_voted" }));
    const body = await res.json();

    const hotelVote = body.votes.find((v: { item: { title: string } }) => v.item.title === "Hotel");
    expect(hotelVote.myVoteOptionId).toBeNull();
    for (const opt of hotelVote.options) {
      expect(opt.votedByMe).toBe(false);
    }
  });

  it("includes item deadline_at in the response", async () => {
    const db = createMockDb(seedData);
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const res = await GET(makeRequest({ tripId: TRIP_ID }));
    const body = await res.json();

    const hotelVote = body.votes.find((v: { item: { title: string } }) => v.item.title === "Hotel");
    expect(hotelVote.item.deadline_at).toBe("2026-05-10T12:00:00Z");

    const dinnerVote = body.votes.find((v: { item: { title: string } }) => v.item.title === "Dinner spot");
    expect(dinnerVote.item.deadline_at).toBeNull();
  });

  it("only returns pending items, not todo or confirmed", async () => {
    const db = createMockDb({
      trip_items: [
        { id: ITEM_ID_1, trip_id: TRIP_ID, title: "Hotel", item_type: "hotel", stage: "pending", created_at: "2026-04-01T00:00:00Z" },
        { id: ITEM_ID_2, trip_id: TRIP_ID, title: "Flight", item_type: "flight", stage: "todo", created_at: "2026-04-02T00:00:00Z" },
        { id: "id3", trip_id: TRIP_ID, title: "Insurance", item_type: "insurance", stage: "confirmed", created_at: "2026-04-03T00:00:00Z" },
      ],
      trip_item_options: [],
      votes: [],
    });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const res = await GET(makeRequest({ tripId: TRIP_ID }));
    const body = await res.json();

    expect(body.votes).toHaveLength(1);
    expect(body.votes[0].item.title).toBe("Hotel");
  });
});

/**
 * Unit tests for the /option command handler.
 *
 * Covers:
 *  - Input validation (missing pipe, empty query/name)
 *  - No active trip
 *  - Item not found
 *  - Matched item is a task (not a decision)
 *  - Decision item found in todo stage → success + /vote hint
 *  - Decision item found in pending stage → success + "voting open" note
 *  - Duplicate option name (case-insensitive)
 *  - DB error from addOption
 *  - Prefers decision item over task when both match the query
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockDb, resetIdCounter } from "../setup/mocks/db";

vi.mock("@/lib/db");

import { createAdminClient } from "@/lib/db";
import { handleOption } from "@/bot/commands/option";

const ctx = {
  lineGroupId: "C123",
  dbGroupId: "group-1",
  userId: "user-1",
  replyToken: undefined,
};

const BASE_TRIP = { id: "trip-1", group_id: "group-1", destination_name: "Tokyo", status: "active" };

const DECISION_ITEM_TODO = {
  id: "item-1",
  trip_id: "trip-1",
  title: "Choose restaurant",
  item_type: "restaurant",
  item_kind: "decision",
  stage: "todo",
};

const DECISION_ITEM_PENDING = {
  id: "item-2",
  trip_id: "trip-1",
  title: "Choose hotel",
  item_type: "hotel",
  item_kind: "decision",
  stage: "pending",
};

const TASK_ITEM = {
  id: "item-3",
  trip_id: "trip-1",
  title: "Book travel insurance",
  item_type: "insurance",
  item_kind: "task",
  stage: "todo",
};

describe("handleOption", () => {
  beforeEach(() => {
    resetIdCounter();
    vi.clearAllMocks();
  });

  // ── Input validation ────────────────────────────────────────────────────────

  it("shows usage when no args are provided", async () => {
    const db = createMockDb({});
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);
    const reply = vi.fn().mockResolvedValue(undefined);

    await handleOption([], { ...ctx, dbGroupId: null }, reply);

    expect(reply).toHaveBeenCalledWith(expect.stringContaining("Usage: /option"));
  });

  it("shows pipe separator error when no | is present in args", async () => {
    const db = createMockDb({ trips: [BASE_TRIP], trip_items: [DECISION_ITEM_TODO] });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);
    const reply = vi.fn().mockResolvedValue(undefined);

    await handleOption(["restaurant", "Ramen", "Shop"], ctx, reply);

    expect(reply).toHaveBeenCalledWith(expect.stringContaining("|"));
  });

  it("shows error when item query is empty (| option-name)", async () => {
    const db = createMockDb({ trips: [BASE_TRIP], trip_items: [DECISION_ITEM_TODO] });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);
    const reply = vi.fn().mockResolvedValue(undefined);

    await handleOption(["|", "Ramen", "Shop"], ctx, reply);

    expect(reply).toHaveBeenCalledWith(expect.stringContaining("required"));
  });

  it("shows error when option name is empty (restaurant |)", async () => {
    const db = createMockDb({ trips: [BASE_TRIP], trip_items: [DECISION_ITEM_TODO] });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);
    const reply = vi.fn().mockResolvedValue(undefined);

    await handleOption(["restaurant", "|"], ctx, reply);

    expect(reply).toHaveBeenCalledWith(expect.stringContaining("required"));
  });

  // ── Trip and item lookup ────────────────────────────────────────────────────

  it("replies with no-active-trip message when no trip exists", async () => {
    const db = createMockDb({ trips: [], trip_items: [] });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);
    const reply = vi.fn().mockResolvedValue(undefined);

    await handleOption(["restaurant", "|", "Ramen", "Shop"], ctx, reply);

    expect(reply).toHaveBeenCalledWith(expect.stringContaining("No active trip"));
  });

  it("replies not found when no item matches the query", async () => {
    const db = createMockDb({ trips: [BASE_TRIP], trip_items: [] });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);
    const reply = vi.fn().mockResolvedValue(undefined);

    await handleOption(["hotel", "|", "Grand", "Hyatt"], ctx, reply);

    expect(reply).toHaveBeenCalledWith(expect.stringContaining("No decision item matching"));
    expect(reply).toHaveBeenCalledWith(expect.stringContaining("/decide"));
  });

  it("redirects to /decide when the matched item is a task, not a decision", async () => {
    const db = createMockDb({ trips: [BASE_TRIP], trip_items: [TASK_ITEM] });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);
    const reply = vi.fn().mockResolvedValue(undefined);

    await handleOption(["insurance", "|", "AXA", "Policy"], ctx, reply);

    expect(reply).toHaveBeenCalledWith(expect.stringContaining("planning task"));
    expect(reply).toHaveBeenCalledWith(expect.stringContaining("/decide"));
  });

  // ── Successful option addition ──────────────────────────────────────────────

  it("adds option to a todo decision item and hints /vote", async () => {
    const db = createMockDb({
      trips: [BASE_TRIP],
      trip_items: [DECISION_ITEM_TODO],
      trip_item_options: [],
    });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);
    const reply = vi.fn().mockResolvedValue(undefined);

    await handleOption(["restaurant", "|", "Ramen", "Shop", "Osaka"], ctx, reply);

    expect(reply).toHaveBeenCalledWith(expect.stringContaining('Added option "Ramen Shop Osaka"'));
    expect(reply).toHaveBeenCalledWith(expect.stringContaining("/vote"));

    const options = db._tables.get("trip_item_options") ?? [];
    expect(options).toHaveLength(1);
    expect(options[0]).toMatchObject({
      trip_item_id: "item-1",
      provider: "manual",
      name: "Ramen Shop Osaka",
    });
  });

  it("adds option to a pending decision item and notes voting is already open", async () => {
    const db = createMockDb({
      trips: [BASE_TRIP],
      trip_items: [DECISION_ITEM_PENDING],
      trip_item_options: [],
    });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);
    const reply = vi.fn().mockResolvedValue(undefined);

    await handleOption(["hotel", "|", "Grand", "Hyatt", "Tokyo"], ctx, reply);

    expect(reply).toHaveBeenCalledWith(expect.stringContaining('Added option "Grand Hyatt Tokyo"'));
    expect(reply).toHaveBeenCalledWith(expect.stringContaining("Voting is already open"));
  });

  // ── Duplicate detection ─────────────────────────────────────────────────────

  it("rejects a duplicate option name (exact case-insensitive match)", async () => {
    const db = createMockDb({
      trips: [BASE_TRIP],
      trip_items: [DECISION_ITEM_TODO],
      trip_item_options: [
        {
          id: "opt-1",
          trip_item_id: "item-1",
          provider: "manual",
          name: "Ramen Shop Osaka",
        },
      ],
    });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);
    const reply = vi.fn().mockResolvedValue(undefined);

    // Submit with different casing to test case-insensitive dedup
    await handleOption(["restaurant", "|", "ramen", "shop", "osaka"], ctx, reply);

    expect(reply).toHaveBeenCalledWith(expect.stringContaining("already an option"));
  });

  // ── Item kind preference ────────────────────────────────────────────────────

  it("prefers decision item over task item when both match the query", async () => {
    const taskWithSameType = { ...TASK_ITEM, id: "item-task", item_type: "restaurant", title: "Restaurant shortlist" };
    const db = createMockDb({
      trips: [BASE_TRIP],
      trip_items: [taskWithSameType, DECISION_ITEM_TODO],
      trip_item_options: [],
    });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);
    const reply = vi.fn().mockResolvedValue(undefined);

    await handleOption(["restaurant", "|", "Ramen", "Shop"], ctx, reply);

    // Should succeed (matched the decision item, not the task)
    expect(reply).toHaveBeenCalledWith(expect.stringContaining("Added option"));
    const options = db._tables.get("trip_item_options") ?? [];
    expect(options[0]).toMatchObject({ trip_item_id: "item-1" });
  });

  // ── DB error path ───────────────────────────────────────────────────────────

  it("replies with a generic error when the DB insert fails", async () => {
    const db = createMockDb(
      { trips: [BASE_TRIP], trip_items: [DECISION_ITEM_TODO] },
      { trip_item_options: { message: "insert failed", code: "23505" } }
    );
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);
    const reply = vi.fn().mockResolvedValue(undefined);

    await handleOption(["restaurant", "|", "Ramen", "Shop"], ctx, reply);

    expect(reply).toHaveBeenCalledWith(expect.stringContaining("Failed to add the option"));
  });
});

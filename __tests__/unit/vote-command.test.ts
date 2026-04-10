import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockDb, resetIdCounter } from "../setup/mocks/db";

vi.mock("@/lib/db");
vi.mock("@/services/decisions", () => ({
  startDecision: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/line", () => ({
  pushText: vi.fn().mockResolvedValue(undefined),
}));

import { createAdminClient } from "@/lib/db";
import { handleVote } from "@/bot/commands/vote";

const ctx = {
  lineGroupId: "C123",
  dbGroupId: "group-1",
  userId: "user-1",
  replyToken: undefined,
};

describe("handleVote", () => {
  beforeEach(() => {
    resetIdCounter();
    vi.clearAllMocks();
  });

  it("rejects planning items and asks for an explicit decision item", async () => {
    const db = createMockDb({
      trips: [{ id: "trip-1", group_id: "group-1", destination_name: "Tokyo", status: "active" }],
      trip_items: [
        {
          id: "item-1",
          trip_id: "trip-1",
          title: "Restaurant shortlist",
          item_type: "restaurant",
          item_kind: "task",
          stage: "todo",
        },
      ],
    });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);
    const reply = vi.fn().mockResolvedValue(undefined);

    await handleVote(["restaurant"], ctx, reply);

    expect(reply).toHaveBeenCalledWith(
      expect.stringContaining("planning item")
    );
    expect(reply).toHaveBeenCalledWith(
      expect.stringContaining("/decide")
    );
  });

  it("prefers a decision item when both planning and decision items match", async () => {
    const { startDecision } = await import("@/services/decisions");
    const db = createMockDb({
      trips: [{ id: "trip-1", group_id: "group-1", destination_name: "Tokyo", status: "active" }],
      trip_items: [
        {
          id: "task-1",
          trip_id: "trip-1",
          title: "Restaurant shortlist",
          item_type: "restaurant",
          item_kind: "task",
          stage: "todo",
        },
        {
          id: "decision-1",
          trip_id: "trip-1",
          title: "Choose restaurant",
          item_type: "restaurant",
          item_kind: "decision",
          stage: "todo",
        },
      ],
    });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);
    const reply = vi.fn().mockResolvedValue(undefined);

    await handleVote(["restaurant"], ctx, reply);

    expect(vi.mocked(startDecision)).toHaveBeenCalledWith(
      expect.objectContaining({ itemId: "decision-1" })
    );
  });
});

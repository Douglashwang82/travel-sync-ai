import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockDb, resetIdCounter } from "../setup/mocks/db";

vi.mock("@/lib/db");

import { createAdminClient } from "@/lib/db";
import { rememberPlace } from "@/services/memory";

describe("knowledge separation", () => {
  beforeEach(() => {
    resetIdCounter();
    vi.clearAllMocks();
  });

  it("rememberPlace stores knowledge without creating trip items or vote options", async () => {
    const db = createMockDb({
      trip_memories: [],
      trip_items: [],
      trip_item_options: [],
    });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    await rememberPlace({
      tripId: "trip-1",
      groupId: "group-1",
      itemType: "restaurant",
      title: "Utt",
      summary: "Shared in chat",
    });

    expect(db._tables.get("trip_memories")).toHaveLength(1);
    expect(db._tables.get("trip_items")).toHaveLength(0);
    expect(db._tables.get("trip_item_options")).toHaveLength(0);
  });
});

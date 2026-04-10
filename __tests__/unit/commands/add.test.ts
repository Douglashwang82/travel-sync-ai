import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb, resetIdCounter } from "../../setup/mocks/db";

vi.mock("@/lib/db");
vi.mock("@/lib/line", () => ({
  pushText: vi.fn().mockResolvedValue(undefined),
  replyText: vi.fn().mockResolvedValue(undefined),
}));

import { createAdminClient } from "@/lib/db";
import { handleAdd } from "@/bot/commands/add";
import type { CommandContext } from "@/bot/router";

const GROUP_DB_ID = "group-add-001";
const TRIP_ID = "trip-add-001";

function makeDb(extra: Record<string, unknown[]> = {}) {
  return createMockDb({
    trips: [{ id: TRIP_ID, group_id: GROUP_DB_ID, status: "active", destination_name: "Osaka" }],
    trip_items: [],
    ...extra,
  });
}

function makeCtx(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    lineGroupId: "C-line-group-add",
    dbGroupId: GROUP_DB_ID,
    userId: "user-001",
    replyToken: "reply-token-add",
    ...overrides,
  };
}

beforeEach(() => {
  resetIdCounter();
  vi.clearAllMocks();
});

// ── creates knowledge items ───────────────────────────────────────────────────

describe("handleAdd — creates knowledge items", () => {
  it("saves the item with item_kind 'knowledge'", async () => {
    const db = makeDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const reply = vi.fn().mockResolvedValue(undefined);
    await handleAdd(["Dotonbori", "ramen", "street"], makeCtx(), reply);

    const items = db._tables.get("trip_items") ?? [];
    expect(items).toHaveLength(1);
    expect(items[0].item_kind).toBe("knowledge");
    expect(items[0].title).toBe("Dotonbori ramen street");
    expect(items[0].stage).toBe("todo");
    expect(items[0].source).toBe("command");
  });

  it("infers item_type from keywords in the title", async () => {
    const db = makeDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const reply = vi.fn().mockResolvedValue(undefined);
    await handleAdd(["Park", "Hyatt", "hotel"], makeCtx(), reply);

    const items = db._tables.get("trip_items") ?? [];
    expect(items[0].item_type).toBe("hotel");
  });

  it("defaults item_type to 'other' when no keyword matches", async () => {
    const db = makeDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const reply = vi.fn().mockResolvedValue(undefined);
    await handleAdd(["Interesting", "waterfall"], makeCtx(), reply);

    const items = db._tables.get("trip_items") ?? [];
    expect(items[0].item_type).toBe("other");
  });

  it("joins multi-word args into a single title", async () => {
    const db = makeDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const reply = vi.fn().mockResolvedValue(undefined);
    await handleAdd(["Nishiki", "Market", "Kyoto"], makeCtx(), reply);

    const items = db._tables.get("trip_items") ?? [];
    expect(items[0].title).toBe("Nishiki Market Kyoto");
  });
});

// ── reply messages ────────────────────────────────────────────────────────────

describe("handleAdd — reply messages", () => {
  it("replies with the item title and a hint to use /decide", async () => {
    const db = makeDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const reply = vi.fn().mockResolvedValue(undefined);
    await handleAdd(["Ramen", "restaurant"], makeCtx(), reply);

    expect(reply).toHaveBeenCalledOnce();
    const [message] = reply.mock.calls[0];
    expect(message).toContain("Ramen restaurant");
    expect(message).toContain("knowledge base");
    expect(message).toMatch(/\/decide/i);
  });

  it("reply includes the inferred item type in the /decide hint", async () => {
    const db = makeDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const reply = vi.fn().mockResolvedValue(undefined);
    await handleAdd(["Amazing", "hotel"], makeCtx(), reply);

    const [message] = reply.mock.calls[0];
    expect(message).toContain("hotel");
    expect(message).toMatch(/\/decide hotel/i);
  });
});

// ── validation and error paths ────────────────────────────────────────────────

describe("handleAdd — validation", () => {
  it("replies with usage hint when no args are provided", async () => {
    const db = makeDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const reply = vi.fn().mockResolvedValue(undefined);
    await handleAdd([], makeCtx(), reply);

    expect(reply).toHaveBeenCalledOnce();
    const [message] = reply.mock.calls[0];
    expect(message).toMatch(/usage/i);
  });

  it("replies with 'no active trip' when no trip exists", async () => {
    const db = createMockDb({ trips: [], trip_items: [] });
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const reply = vi.fn().mockResolvedValue(undefined);
    await handleAdd(["Great ramen"], makeCtx(), reply);

    expect(reply).toHaveBeenCalledOnce();
    const [message] = reply.mock.calls[0];
    expect(message).toMatch(/no active trip/i);

    const items = db._tables.get("trip_items") ?? [];
    expect(items).toHaveLength(0);
  });

  it("replies with error message when DB insert fails", async () => {
    const db = createMockDb(
      { trips: [{ id: TRIP_ID, group_id: GROUP_DB_ID, status: "active", destination_name: "Tokyo" }] },
      { trip_items: { message: "connection error" } }
    );
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const reply = vi.fn().mockResolvedValue(undefined);
    await handleAdd(["Book hotel"], makeCtx(), reply);

    expect(reply).toHaveBeenCalledOnce();
    const [message] = reply.mock.calls[0];
    expect(message).toMatch(/failed to add/i);
  });

  it("does nothing when dbGroupId is missing from context", async () => {
    const db = makeDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const reply = vi.fn().mockResolvedValue(undefined);
    await handleAdd(["Some place"], makeCtx({ dbGroupId: null }), reply);

    expect(reply).toHaveBeenCalledOnce();
    // Should reply with usage hint (validation failure)
    const items = db._tables.get("trip_items") ?? [];
    expect(items).toHaveLength(0);
  });
});

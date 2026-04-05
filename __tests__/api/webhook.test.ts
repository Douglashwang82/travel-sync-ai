import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createMockDb, resetIdCounter } from "../setup/mocks/db";

// Mock all external dependencies before importing the route
vi.mock("@/lib/db");
vi.mock("@/lib/env", () => ({ validateEnv: vi.fn() }));
vi.mock("@/lib/line", () => ({
  verifyLineSignature: vi.fn(),
  replyText: vi.fn().mockResolvedValue(undefined),
  pushText: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/services/event-processor", () => ({
  processLineEvent: vi.fn().mockResolvedValue(undefined),
}));
// Mock next/server's `after` to be a no-op (runs synchronously in tests)
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return {
    ...actual,
    after: (fn: () => void) => {
      // Execute synchronously so tests can observe side effects
      Promise.resolve().then(fn);
    },
  };
});

import { createAdminClient } from "@/lib/db";
import { verifyLineSignature } from "@/lib/line";
import { POST } from "@/app/api/line/webhook/route";

const LINE_GROUP_ID = "C1234567890";
const LINE_USER_ID = "U1234567890";

function makeDb() {
  return createMockDb({
    line_groups: [],
    line_events: [],
    raw_messages: [],
  });
}

function makeWebhookRequest(events: object[], signature = "valid-sig") {
  const body = JSON.stringify({ destination: "bot-id", events });
  return new NextRequest("http://localhost/api/line/webhook", {
    method: "POST",
    body,
    headers: {
      "content-type": "application/json",
      "x-line-signature": signature,
    },
  });
}

beforeEach(() => {
  resetIdCounter();
  vi.clearAllMocks();
  vi.mocked(verifyLineSignature).mockReturnValue(true);
});

// ── Signature verification ────────────────────────────────────────────────────

describe("POST /api/line/webhook — signature verification", () => {
  it("returns 401 for invalid signature", async () => {
    vi.mocked(verifyLineSignature).mockReturnValue(false);
    const db = makeDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const req = makeWebhookRequest([], "bad-sig");
    const res = await POST(req);

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.code).toBe("INVALID_SIGNATURE");
  });

  it("returns 200 for valid signature", async () => {
    const db = makeDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const req = makeWebhookRequest([]);
    const res = await POST(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});

// ── Body parsing ──────────────────────────────────────────────────────────────

describe("POST /api/line/webhook — body parsing", () => {
  it("returns 400 for invalid JSON body", async () => {
    const req = new NextRequest("http://localhost/api/line/webhook", {
      method: "POST",
      body: "not-json{{{",
      headers: { "x-line-signature": "sig" },
    });
    vi.mocked(verifyLineSignature).mockReturnValue(true);

    const db = makeDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("INVALID_JSON");
  });

  it("returns 400 for body missing 'events' array", async () => {
    const req = new NextRequest("http://localhost/api/line/webhook", {
      method: "POST",
      body: JSON.stringify({ destination: "bot" }), // no events
      headers: { "x-line-signature": "sig" },
    });
    vi.mocked(verifyLineSignature).mockReturnValue(true);

    const db = makeDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});

// ── Event persistence ─────────────────────────────────────────────────────────

describe("POST /api/line/webhook — event persistence", () => {
  it("upserts line_groups and persists the event", async () => {
    const db = makeDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const events = [
      {
        type: "message",
        webhookEventId: "wid-001",
        timestamp: 1700000000000,
        source: { type: "group", groupId: LINE_GROUP_ID, userId: LINE_USER_ID },
        replyToken: "reply-token-001",
        message: { id: "msg-001", type: "text", text: "Hello!" },
      },
    ];

    await POST(makeWebhookRequest(events));

    const groups = db._tables.get("line_groups") ?? [];
    expect(groups.some((g) => g.line_group_id === LINE_GROUP_ID)).toBe(true);

    const lineEvents = db._tables.get("line_events") ?? [];
    expect(lineEvents).toHaveLength(1);
    expect(lineEvents[0].event_type).toBe("message");
    expect(lineEvents[0].processing_status).toBe("pending");
  });

  it("persists raw_message for text events", async () => {
    const db = makeDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const events = [
      {
        type: "message",
        webhookEventId: "wid-text-001",
        timestamp: 1700000000001,
        source: { type: "group", groupId: LINE_GROUP_ID, userId: LINE_USER_ID },
        replyToken: "reply-token-002",
        message: { id: "msg-002", type: "text", text: "Book a hotel" },
      },
    ];

    await POST(makeWebhookRequest(events));

    const rawMessages = db._tables.get("raw_messages") ?? [];
    expect(rawMessages).toHaveLength(1);
    expect(rawMessages[0].message_text).toBe("Book a hotel");
    expect(rawMessages[0].line_user_id).toBe(LINE_USER_ID);
  });

  it("does not persist raw_message for non-text events", async () => {
    const db = makeDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const events = [
      {
        type: "join",
        webhookEventId: "wid-join-001",
        timestamp: 1700000000002,
        source: { type: "group", groupId: LINE_GROUP_ID },
      },
    ];

    await POST(makeWebhookRequest(events));

    const rawMessages = db._tables.get("raw_messages") ?? [];
    expect(rawMessages).toHaveLength(0);
  });

  it("deduplicates events by webhookEventId", async () => {
    const db = makeDb();
    // Pre-populate with the event already persisted
    db._tables.set("line_events", [
      {
        id: "event-existing",
        line_event_uid: "wid-dup-001",
        event_type: "message",
        processing_status: "processed",
      },
    ]);
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const events = [
      {
        type: "message",
        webhookEventId: "wid-dup-001",
        timestamp: 1700000000003,
        source: { type: "group", groupId: LINE_GROUP_ID, userId: LINE_USER_ID },
        message: { id: "msg-dup", type: "text", text: "Duplicate" },
      },
    ];

    const res = await POST(makeWebhookRequest(events));
    expect(res.status).toBe(200); // Still 200
    // The event was already processed — no new row added
    const lineEvents = db._tables.get("line_events") ?? [];
    expect(lineEvents).toHaveLength(1); // Still 1
  });

  it("handles multiple events in a single webhook call", async () => {
    const db = makeDb();
    vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

    const events = [
      {
        type: "message",
        webhookEventId: "multi-001",
        source: { type: "group", groupId: LINE_GROUP_ID, userId: LINE_USER_ID },
        message: { id: "m1", type: "text", text: "First message" },
      },
      {
        type: "message",
        webhookEventId: "multi-002",
        source: { type: "group", groupId: LINE_GROUP_ID, userId: LINE_USER_ID },
        message: { id: "m2", type: "text", text: "Second message" },
      },
    ];

    const res = await POST(makeWebhookRequest(events));
    expect(res.status).toBe(200);

    const lineEvents = db._tables.get("line_events") ?? [];
    expect(lineEvents).toHaveLength(2);
  });
});

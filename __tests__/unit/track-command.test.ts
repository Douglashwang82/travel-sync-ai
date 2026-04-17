import { describe, it, expect, vi } from "vitest";

// Mock away runtime deps so importing the command module is cheap.
vi.mock("@/lib/db", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/services/tracking/digest", () => ({
  composeAndSendDigest: vi.fn(),
}));

import { __test } from "@/bot/commands/track";

const { detectSourceType } = __test;

describe("detectSourceType", () => {
  it("recognises common feed paths", () => {
    expect(detectSourceType("https://example.com/feed")).toBe("rss");
    expect(detectSourceType("https://example.com/feed/")).toBe("rss");
    expect(detectSourceType("https://example.com/rss")).toBe("rss");
    expect(detectSourceType("https://example.com/atom")).toBe("rss");
  });

  it("recognises feed file extensions", () => {
    expect(detectSourceType("https://example.com/posts.xml")).toBe("rss");
    expect(detectSourceType("https://example.com/index.rss")).toBe("rss");
    expect(detectSourceType("https://example.com/feed.atom")).toBe("rss");
  });

  it("defaults to website for ordinary pages", () => {
    expect(detectSourceType("https://www.timeout.com/tokyo")).toBe("website");
    expect(detectSourceType("https://blog.example.com/posts/123")).toBe("website");
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockDb, resetIdCounter } from "../setup/mocks/db";

vi.mock("@/lib/db");

import { createAdminClient } from "@/lib/db";
import {
  buildTripUrl,
  getTripUrlForGroup,
  getTripUrlForItem,
  appendTripLinkText,
  withFlexTripLink,
} from "@/lib/trip-link";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://test.example.com";

describe("trip-link helpers", () => {
  beforeEach(() => {
    resetIdCounter();
    vi.clearAllMocks();
  });

  describe("buildTripUrl", () => {
    it("returns the canonical /board URL when no page is supplied", () => {
      expect(buildTripUrl("trip-1")).toBe(`${APP_URL}/app/trips/trip-1/board`);
    });

    it("appends a subpage when provided", () => {
      expect(buildTripUrl("trip-1", "/votes")).toBe(
        `${APP_URL}/app/trips/trip-1/votes`
      );
    });

    it("returns null when NEXT_PUBLIC_APP_URL is unset", () => {
      const prev = process.env.NEXT_PUBLIC_APP_URL;
      delete process.env.NEXT_PUBLIC_APP_URL;
      try {
        expect(buildTripUrl("trip-1")).toBeNull();
      } finally {
        process.env.NEXT_PUBLIC_APP_URL = prev;
      }
    });
  });

  describe("getTripUrlForGroup", () => {
    it("returns null when dbGroupId is missing", async () => {
      expect(await getTripUrlForGroup(null)).toBeNull();
      expect(await getTripUrlForGroup(undefined)).toBeNull();
    });

    it("resolves the most recent trip URL for a group", async () => {
      const db = createMockDb({
        trips: [
          { id: "trip-1", group_id: "group-1", updated_at: "2024-01-01" },
          { id: "trip-2", group_id: "group-1", updated_at: "2024-06-01" },
        ],
      });
      vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

      const url = await getTripUrlForGroup("group-1");
      expect(url).toBe(`${APP_URL}/app/trips/trip-2/board`);
    });

    it("returns null when the group has no trip", async () => {
      const db = createMockDb({ trips: [] });
      vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

      expect(await getTripUrlForGroup("group-1")).toBeNull();
    });
  });

  describe("getTripUrlForItem", () => {
    it("looks up the trip via the item's trip_id", async () => {
      const db = createMockDb({
        trip_items: [{ id: "item-1", trip_id: "trip-9" }],
      });
      vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

      expect(await getTripUrlForItem("item-1", "/votes")).toBe(
        `${APP_URL}/app/trips/trip-9/votes`
      );
    });

    it("returns null when the item is unknown", async () => {
      const db = createMockDb({ trip_items: [] });
      vi.mocked(createAdminClient).mockReturnValue(db as ReturnType<typeof createAdminClient>);

      expect(await getTripUrlForItem("missing")).toBeNull();
    });
  });

  describe("appendTripLinkText", () => {
    it("appends the view link when a URL is provided", () => {
      const out = appendTripLinkText("已記錄", "https://x/app/trips/t1/board");
      expect(out).toContain("已記錄");
      expect(out).toContain("https://x/app/trips/t1/board");
    });

    it("returns the original message unchanged when the URL is null", () => {
      expect(appendTripLinkText("已記錄", null)).toBe("已記錄");
    });
  });

  describe("withFlexTripLink", () => {
    it("adds a separator + clickable link to a bubble body", () => {
      const bubble = {
        type: "bubble" as const,
        body: {
          type: "box" as const,
          layout: "vertical" as const,
          contents: [{ type: "text" as const, text: "hello" }],
        },
      };
      const out = withFlexTripLink(bubble, "https://x/app/trips/t1/board");
      // body should now have 3 children (text, separator, link text)
      expect(out.type).toBe("bubble");
      if (out.type !== "bubble" || out.body?.type !== "box") throw new Error("shape changed");
      expect(out.body.contents).toHaveLength(3);
      const last = out.body.contents[2] as { type: string; action?: { uri: string } };
      expect(last.type).toBe("text");
      expect(last.action?.uri).toBe("https://x/app/trips/t1/board");
    });

    it("no-ops for a carousel container", () => {
      const carousel = {
        type: "carousel" as const,
        contents: [],
      };
      expect(withFlexTripLink(carousel, "https://x/app/trips/t1/board")).toBe(carousel);
    });

    it("no-ops when the URL is null", () => {
      const bubble = {
        type: "bubble" as const,
        body: {
          type: "box" as const,
          layout: "vertical" as const,
          contents: [{ type: "text" as const, text: "hello" }],
        },
      };
      expect(withFlexTripLink(bubble, null)).toBe(bubble);
    });
  });
});

import { describe, it, expect } from "vitest";
import { detectSocial } from "@/lib/social/detect";

describe("detectSocial", () => {
  it("returns null for invalid input", () => {
    expect(detectSocial("not a url")).toBeNull();
    expect(detectSocial("ftp://example.com")).toBeNull();
    expect(detectSocial("https://example.com/p/abc")).toBeNull();
  });

  describe("youtube", () => {
    it("matches watch URLs", () => {
      expect(detectSocial("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toEqual({
        platform: "youtube",
        permalink: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        id: "dQw4w9WgXcQ",
      });
    });

    it("matches youtu.be short links", () => {
      expect(detectSocial("https://youtu.be/dQw4w9WgXcQ?t=42")).toEqual({
        platform: "youtube",
        permalink: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        id: "dQw4w9WgXcQ",
      });
    });

    it("matches /shorts/", () => {
      expect(detectSocial("https://www.youtube.com/shorts/abc123XYZ")).toMatchObject({
        platform: "youtube",
        id: "abc123XYZ",
      });
    });

    it("matches /embed/", () => {
      expect(detectSocial("https://www.youtube.com/embed/abc123XYZ")).toMatchObject({
        platform: "youtube",
        id: "abc123XYZ",
      });
    });

    it("ignores youtube channel pages with no video id", () => {
      expect(detectSocial("https://www.youtube.com/@someone")).toBeNull();
    });
  });

  describe("instagram", () => {
    it("matches post URLs", () => {
      expect(detectSocial("https://www.instagram.com/p/DEmqQHFNYNj/")).toEqual({
        platform: "instagram",
        permalink: "https://www.instagram.com/p/DEmqQHFNYNj/",
        id: "DEmqQHFNYNj",
      });
    });

    it("matches reels and tv", () => {
      expect(detectSocial("https://www.instagram.com/reel/abc_123/")).toMatchObject({
        platform: "instagram",
        id: "abc_123",
      });
      expect(detectSocial("https://www.instagram.com/tv/xyz/")).toMatchObject({
        platform: "instagram",
        id: "xyz",
      });
    });

    it("strips query params from permalink", () => {
      const m = detectSocial(
        "https://www.instagram.com/p/DEmqQHFNYNj/?utm_source=ig_embed",
      );
      expect(m?.permalink).toBe("https://www.instagram.com/p/DEmqQHFNYNj/");
    });

    it("ignores profile pages", () => {
      expect(detectSocial("https://www.instagram.com/someone/")).toBeNull();
    });
  });

  describe("threads", () => {
    it("matches threads.net post URLs", () => {
      expect(
        detectSocial("https://www.threads.net/@user/post/C12abc"),
      ).toMatchObject({
        platform: "threads",
        id: "C12abc",
        permalink: "https://www.threads.net/@user/post/C12abc/",
      });
    });

    it("matches threads.com", () => {
      expect(
        detectSocial("https://www.threads.com/@user/post/C12abc"),
      ).toMatchObject({ platform: "threads", id: "C12abc" });
    });
  });

  describe("facebook", () => {
    it("matches facebook.com URLs", () => {
      expect(
        detectSocial("https://www.facebook.com/zuck/posts/12345"),
      ).toMatchObject({ platform: "facebook" });
    });

    it("matches fb.watch", () => {
      expect(detectSocial("https://fb.watch/abc/")).toMatchObject({
        platform: "facebook",
      });
    });
  });
});

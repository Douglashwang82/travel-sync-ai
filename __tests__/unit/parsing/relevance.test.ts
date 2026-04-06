import { describe, it, expect } from "vitest";
import { checkRelevance } from "@/services/parsing/relevance";

describe("checkRelevance", () => {
  // ── Irrelevant patterns ───────────────────────────────────────────────────

  it("marks single emoji reactions as irrelevant", () => {
    expect(checkRelevance("👍")).toMatchObject({ relevant: false, reason: "pattern_match" });
    expect(checkRelevance("😂")).toMatchObject({ relevant: false, reason: "pattern_match" });
  });

  it("marks acknowledgement words as irrelevant", () => {
    expect(checkRelevance("ok")).toMatchObject({ relevant: false, reason: "pattern_match" });
    expect(checkRelevance("收到")).toMatchObject({ relevant: false, reason: "pattern_match" });
    expect(checkRelevance("np")).toMatchObject({ relevant: false, reason: "pattern_match" });
    expect(checkRelevance("sure")).toMatchObject({ relevant: false, reason: "pattern_match" });
  });

  it("marks greetings as irrelevant", () => {
    expect(checkRelevance("早")).toMatchObject({ relevant: false, reason: "pattern_match" });
    expect(checkRelevance("晚安")).toMatchObject({ relevant: false, reason: "pattern_match" });
    expect(checkRelevance("gm")).toMatchObject({ relevant: false, reason: "pattern_match" });
  });

  it("marks bare time strings as irrelevant", () => {
    expect(checkRelevance("8:30")).toMatchObject({ relevant: false, reason: "pattern_match" });
    expect(checkRelevance("14:00")).toMatchObject({ relevant: false, reason: "pattern_match" });
  });

  it("marks thank-you messages as irrelevant", () => {
    expect(checkRelevance("謝謝")).toMatchObject({ relevant: false, reason: "pattern_match" });
    expect(checkRelevance("thanks!")).toMatchObject({ relevant: false, reason: "pattern_match" });
  });

  // ── Travel keyword signal ─────────────────────────────────────────────────

  it("marks messages with hotel keyword as relevant", () => {
    expect(checkRelevance("hotel")).toMatchObject({ relevant: true, reason: "has_travel_keyword" });
    expect(checkRelevance("我想訂飯店")).toMatchObject({ relevant: true, reason: "has_travel_keyword" });
  });

  it("marks messages with flight keywords as relevant", () => {
    expect(checkRelevance("flight EK123")).toMatchObject({ relevant: true, reason: "has_travel_keyword" });
    expect(checkRelevance("機場接送")).toMatchObject({ relevant: true, reason: "has_travel_keyword" });
  });

  it("marks messages with date patterns as relevant", () => {
    expect(checkRelevance("7/15出發")).toMatchObject({ relevant: true, reason: "has_travel_keyword" });
    expect(checkRelevance("2026-05-10")).toMatchObject({ relevant: true, reason: "has_travel_keyword" });
    expect(checkRelevance("7月15")).toMatchObject({ relevant: true, reason: "has_travel_keyword" });
  });

  it("marks messages with budget keywords as relevant", () => {
    expect(checkRelevance("budget $5000")).toMatchObject({ relevant: true, reason: "has_travel_keyword" });
    expect(checkRelevance("多少錢")).toMatchObject({ relevant: true, reason: "has_travel_keyword" });
  });

  it("marks messages with booking keywords as relevant", () => {
    expect(checkRelevance("訂餐廳")).toMatchObject({ relevant: true, reason: "has_travel_keyword" });
    expect(checkRelevance("reserve a table")).toMatchObject({ relevant: true, reason: "has_travel_keyword" });
  });

  // ── Length checks ─────────────────────────────────────────────────────────

  it("marks strings shorter than 4 chars as irrelevant (no travel keyword)", () => {
    expect(checkRelevance("hi")).toMatchObject({ relevant: false, reason: "too_short" });
    expect(checkRelevance("lmk")).toMatchObject({ relevant: false, reason: "too_short" });
  });

  it("marks medium messages (>=10 chars, no keyword) as relevant for LLM inspection", () => {
    const result = checkRelevance("we need to plan our activities carefully");
    expect(result).toMatchObject({ relevant: true, reason: "long_enough" });
  });

  it("marks short messages (4-9 chars) with no travel signal as irrelevant", () => {
    // 5 chars, no keyword, no date pattern, not irrelevant pattern
    const result = checkRelevance("hello");
    expect(result).toMatchObject({ relevant: false, reason: "no_signal" });
  });

  // ── Edge cases ────────────────────────────────────────────────────────────

  it("is case-insensitive for keyword detection", () => {
    expect(checkRelevance("HOTEL reservation")).toMatchObject({ relevant: true });
    expect(checkRelevance("Flight EK400")).toMatchObject({ relevant: true });
  });

  it("handles empty string gracefully", () => {
    const result = checkRelevance("");
    expect(result.relevant).toBe(false);
  });

  it("handles whitespace-only string gracefully", () => {
    const result = checkRelevance("   ");
    expect(result.relevant).toBe(false);
  });
});

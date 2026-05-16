import { afterEach, describe, expect, it, vi } from "vitest";
import { getModel } from "@/lib/gemini";

const originalModel = process.env.GEMINI_MODEL;

afterEach(() => {
  vi.restoreAllMocks();

  if (originalModel === undefined) {
    delete process.env.GEMINI_MODEL;
  } else {
    process.env.GEMINI_MODEL = originalModel;
  }
});

describe("getModel", () => {
  it("defaults to the current stable Flash model", () => {
    delete process.env.GEMINI_MODEL;

    expect(getModel()).toBe("gemini-2.5-flash");
  });

  it("falls back when a deprecated Gemini 2.0 Flash override is configured", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    process.env.GEMINI_MODEL = "gemini-2.0-flash";

    expect(getModel()).toBe("gemini-2.5-flash");
    expect(warn).toHaveBeenCalledWith(
      "[gemini] gemini-2.0-flash is deprecated/unavailable; falling back to gemini-2.5-flash"
    );
  });

  it("falls back when the deprecated model is configured with a models/ prefix", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    process.env.GEMINI_MODEL = "models/gemini-2.0-flash";

    expect(getModel()).toBe("gemini-2.5-flash");
  });

  it("preserves supported custom model overrides", () => {
    process.env.GEMINI_MODEL = "gemini-2.5-flash-lite";

    expect(getModel()).toBe("gemini-2.5-flash-lite");
  });
});

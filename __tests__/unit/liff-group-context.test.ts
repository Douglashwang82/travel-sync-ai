import { describe, it, expect, beforeEach, vi } from "vitest";
import { stashLineGroupId, popLineGroupId } from "@/lib/liff-group-context";

function makeStorage() {
  const store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, val: string) => { store[key] = val; },
    removeItem: (key: string) => { delete store[key]; },
    _store: store,
  };
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("stashLineGroupId / popLineGroupId", () => {
  it("stash then pop returns the stored group ID", () => {
    vi.stubGlobal("sessionStorage", makeStorage());
    stashLineGroupId("C_GROUP_123");
    expect(popLineGroupId()).toBe("C_GROUP_123");
  });

  it("pop clears the value so a second pop returns null", () => {
    vi.stubGlobal("sessionStorage", makeStorage());
    stashLineGroupId("C_GROUP_123");
    popLineGroupId();
    expect(popLineGroupId()).toBeNull();
  });

  it("pop returns null when nothing was stashed", () => {
    vi.stubGlobal("sessionStorage", makeStorage());
    expect(popLineGroupId()).toBeNull();
  });

  it("stashing twice overwrites the first value", () => {
    vi.stubGlobal("sessionStorage", makeStorage());
    stashLineGroupId("C_FIRST");
    stashLineGroupId("C_SECOND");
    expect(popLineGroupId()).toBe("C_SECOND");
  });

  it("stash is a no-op and pop returns null when sessionStorage throws", () => {
    vi.stubGlobal("sessionStorage", {
      getItem: () => { throw new Error("unavailable"); },
      setItem: () => { throw new Error("unavailable"); },
      removeItem: () => { throw new Error("unavailable"); },
    });
    expect(() => stashLineGroupId("C_GROUP_123")).not.toThrow();
    expect(popLineGroupId()).toBeNull();
  });
});

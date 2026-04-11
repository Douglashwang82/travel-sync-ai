import { describe, expect, it } from "vitest";
import { toLiffErrorMessage } from "@/lib/liff-errors";

describe("toLiffErrorMessage", () => {
  it("falls back when no error message is available", () => {
    expect(toLiffErrorMessage("session", null, "Fallback message")).toBe(
      "Fallback message"
    );
  });

  it("normalizes unauthenticated LIFF errors", () => {
    expect(
      toLiffErrorMessage(
        "session",
        new Error("Not authenticated. Please reopen in LINE."),
        "Fallback message"
      )
    ).toBe("Please reopen this page inside LINE and try again.");
  });

  it("normalizes session loading failures", () => {
    expect(
      toLiffErrorMessage(
        "session",
        new Error("Failed to load session"),
        "Fallback message"
      )
    ).toBe(
      "We could not verify your LINE session. Reopen this page inside LINE and try again."
    );
  });

  it("normalizes expired token failures", () => {
    expect(
      toLiffErrorMessage(
        "session",
        new Error("Invalid or expired LIFF token"),
        "Fallback message"
      )
    ).toBe("Your LINE session expired. Reopen this page inside LINE to continue.");
  });

  it("normalizes missing authorization header failures", () => {
    expect(
      toLiffErrorMessage(
        "session",
        new Error("Missing Authorization header"),
        "Fallback message"
      )
    ).toBe("This page must be opened from LINE to load correctly.");
  });

  it("returns the fallback for generic load errors", () => {
    expect(
      toLiffErrorMessage(
        "readiness",
        new Error("Failed to load readiness"),
        "Readiness fallback"
      )
    ).toBe("Readiness fallback");
  });

  it("adds context for generic task failures", () => {
    expect(
      toLiffErrorMessage(
        "votes",
        new Error("Failed to submit vote"),
        "Vote fallback"
      )
    ).toBe("Vote fallback (votes)");
  });

  it("returns unknown messages unchanged", () => {
    expect(
      toLiffErrorMessage(
        "session",
        new Error("Custom downstream error"),
        "Fallback message"
      )
    ).toBe("Custom downstream error");
  });
});

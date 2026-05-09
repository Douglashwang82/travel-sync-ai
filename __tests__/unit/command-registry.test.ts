import { describe, expect, it } from "vitest";

import { COMMAND_ROUTES, RATE_LIMIT_EXEMPT_COMMANDS } from "@/bot/command-registry";
import { COMMAND_CATALOG, PUBLIC_COMMAND_CATALOG } from "@/lib/command-catalog";

describe("command registry", () => {
  it("routes every catalog command exactly once", () => {
    const catalogCommands = COMMAND_CATALOG.map((entry) => entry.command);
    const routedCommands = COMMAND_ROUTES.map((route) => route.command);

    expect(new Set(catalogCommands).size).toBe(catalogCommands.length);
    expect(new Set(routedCommands).size).toBe(routedCommands.length);
    expect(routedCommands).toEqual(catalogCommands);
    expect(COMMAND_ROUTES.every((route) => typeof route.handler === "function")).toBe(true);
  });

  it("documents every public command and intentionally hides private data deletion", () => {
    expect(PUBLIC_COMMAND_CATALOG.map((entry) => entry.command)).not.toContain(
      "/delete-my-data"
    );
    expect(COMMAND_CATALOG.find((entry) => entry.command === "/delete-my-data")).toMatchObject({
      helpVisible: false,
    });
  });

  it("keeps privacy and help commands exempt from rate limits", () => {
    expect(RATE_LIMIT_EXEMPT_COMMANDS.has("/help")).toBe(true);
    expect(RATE_LIMIT_EXEMPT_COMMANDS.has("/optout")).toBe(true);
    expect(RATE_LIMIT_EXEMPT_COMMANDS.has("/optin")).toBe(true);
    expect(RATE_LIMIT_EXEMPT_COMMANDS.has("/delete-my-data")).toBe(true);
    expect(RATE_LIMIT_EXEMPT_COMMANDS.has("/vote")).toBe(false);
  });
});

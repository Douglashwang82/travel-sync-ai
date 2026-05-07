import type { CommandName } from "./command-catalog";

const COMMAND_PAGE_PATH: Partial<Record<CommandName, string>> = {
  "/start": "",
  "/status": "/board",
  "/itinerary": "/itinerary",
  "/add": "/board",
  "/idea": "/board",
  "/ideas": "/board",
  "/decide": "/votes",
  "/option": "/votes",
  "/vote": "/votes",
  "/nudge": "",
  "/ready": "",
  "/ops": "",
  "/incident": "",
  "/booked": "/board",
  "/confirm": "/board",
  "/docs": "/board",
  "/pack": "/board",
  "/budget": "/expenses",
  "/exp": "/expenses",
  "/exp-summary": "/expenses",
  "/ask": "",
  "/share": "/board",
  "/recommend": "/board",
  "/track": "",
  "/cancel": "/settings",
  "/complete": "/settings",
};

export function isLinkableCommand(cmd: string): cmd is CommandName {
  return cmd in COMMAND_PAGE_PATH;
}

export function buildCommandPageUrl(cmd: string, tripId: string): string | null {
  if (!isLinkableCommand(cmd)) return null;
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  if (!base) return null;
  return `${base}/app/trips/${tripId}${COMMAND_PAGE_PATH[cmd] ?? ""}`;
}

export type CommandCategory =
  | "trip"
  | "planning"
  | "decisions"
  | "readiness"
  | "operations"
  | "finance"
  | "privacy"
  | "support";

export type CommandCatalogEntry = {
  command: string;
  usage?: string;
  example: string;
  purpose: string;
  description: string;
  icon: string;
  category: CommandCategory;
  helpVisible?: boolean;
  rateLimitExempt?: boolean;
};

export const COMMAND_CATALOG = [
  {
    command: "/start",
    usage: "[destination?] [dates?]",
    example: "/start Osaka 7/15-7/20",
    purpose: "Create the active trip context for a LINE group.",
    description:
      "Start a new trip. Destination, dates, and participants can all be refined later.",
    icon: ">>",
    category: "trip",
  },
  {
    command: "/status",
    example: "/status",
    purpose: "Show the current planning board.",
    description: "Show trip items grouped by To-Do, Pending, and Confirmed.",
    icon: "[]",
    category: "trip",
  },
  {
    command: "/itinerary",
    usage: "[date?]",
    example: "/itinerary 2026-07-15",
    purpose: "Retrieve the current confirmed itinerary.",
    description:
      "Show the whole confirmed itinerary, or only one day's plan when a date is provided.",
    icon: "CAL",
    category: "trip",
  },
  {
    command: "/add",
    usage: "[task]",
    example: "/add Renew passport",
    purpose: "Add a concrete planning task that must be done.",
    description: "Add a non-voting task to the trip board.",
    icon: "+",
    category: "planning",
  },
  {
    command: "/idea",
    usage: "[category?] [text]",
    example: "/idea restaurant Any ramen near Shinjuku",
    purpose: "Capture a loose brainstorm idea with low commitment.",
    description:
      "Drop a brainstorm idea onto the idea board without creating a planning task or vote.",
    icon: "*",
    category: "planning",
  },
  {
    command: "/ideas",
    example: "/ideas",
    purpose: "Review brainstorm ideas for the active trip.",
    description: "List open brainstorm ideas grouped by category.",
    icon: "**",
    category: "planning",
  },
  {
    command: "/decide",
    usage: "[topic]",
    example: "/decide restaurant",
    purpose: "Open a decision topic the group needs to choose.",
    description: "Create a decision item before options and voting begin.",
    icon: "?",
    category: "decisions",
  },
  {
    command: "/option",
    usage: "[decision-topic] | [option-name]",
    example: "/option restaurant | Ramen Shop Osaka",
    purpose: "Add a candidate option to an existing decision.",
    description: "Attach a manual option to a decision item.",
    icon: "|",
    category: "decisions",
  },
  {
    command: "/vote",
    usage: "[decision-topic]",
    example: "/vote restaurant",
    purpose: "Start voting for a decision that already exists.",
    description: "Open or refresh voting for a decision item and post vote controls.",
    icon: "X",
    category: "decisions",
  },
  {
    command: "/nudge",
    example: "/nudge",
    purpose: "Remind the group about blocked or stale work.",
    description:
      "Identify pending votes, stale tasks, missing bookings, or other open blockers and send a prioritized reminder.",
    icon: "!",
    category: "operations",
  },
  {
    command: "/ready",
    example: "/ready",
    purpose: "Answer whether the group is ready to go.",
    description:
      "Show pre-trip readiness across committed dates, bookings, documents, and blockers.",
    icon: "OK",
    category: "readiness",
  },
  {
    command: "/ops",
    example: "/ops",
    purpose: "Show operational attention items for trip execution.",
    description:
      "Summarize day-of execution needs such as upcoming plans, booking gaps, and incidents.",
    icon: "!!",
    category: "operations",
  },
  {
    command: "/incident",
    usage: "[what happened]",
    example: "/incident I lost my passport",
    purpose: "Start an incident workflow from a real disruption.",
    description: "Classify a disruption, create response tasks, and return an immediate playbook.",
    icon: "SOS",
    category: "operations",
  },
  {
    command: "/booked",
    usage: "[item name] [confirmation ref]",
    example: "/booked hotel AX-12345",
    purpose: "Manually mark a known trip item as booked.",
    description: "Record a booking reference or link for a confirmed trip item.",
    icon: "#",
    category: "operations",
  },
  {
    command: "/confirm",
    usage: "[forwarded booking text]",
    example: "/confirm Booking confirmed! Ref AX-12345 Hotel Sunshine check-in July 15",
    purpose: "Parse pasted booking text and mark the matching item booked.",
    description:
      "Use AI-assisted parsing to extract booking details from a forwarded confirmation.",
    icon: "@",
    category: "operations",
  },
  {
    command: "/docs",
    usage: "add [type] [label?] [expires YYYY-MM-DD?] | list",
    example: "/docs add passport expires 2028-03-15",
    purpose: "Manage travel document readiness.",
    description:
      "Record and review passport, visa, insurance, and other document status with expiry warnings.",
    icon: "ID",
    category: "readiness",
  },
  {
    command: "/pack",
    usage: "add [category?] [item] | list | check [#]",
    example: "/pack add clothing rain jacket",
    purpose: "Manage the group packing checklist.",
    description:
      "Add, list, and check off packing items for documents, clothing, toiletries, electronics, safety, or general needs.",
    icon: "PK",
    category: "readiness",
  },
  {
    command: "/budget",
    usage: "[amount] [currency?]",
    example: "/budget 50000 JPY",
    purpose: "Set the trip budget envelope.",
    description: "Set or update the trip's total planned budget. Currency defaults to TWD.",
    icon: "$",
    category: "finance",
  },
  {
    command: "/exp",
    usage: "[amount] [description] [for @name1 @name2 | for all]",
    example: "/exp 1200 dinner for @Alice @Bob",
    purpose: "Record a paid expense and split it.",
    description: "Record a payment and split it across selected members or the whole group.",
    icon: "$+",
    category: "finance",
  },
  {
    command: "/exp-summary",
    example: "/exp-summary",
    purpose: "Show balances, settlements, and budget progress.",
    description: "Show who owes whom, minimum settlements, and budget usage when available.",
    icon: "$=",
    category: "finance",
  },
  {
    command: "/ask",
    usage: "[question]",
    example: "/ask what hotels have we confirmed?",
    purpose: "Answer read-only questions over the current trip state.",
    description:
      "Use the trip board, bookings, documents, expenses, and ideas to answer without mutating data.",
    icon: "AI",
    category: "support",
  },
  {
    command: "/share",
    usage: "[url]",
    example: "/share https://booking.com/hotel/xyz",
    purpose: "Save a travel link as trip knowledge.",
    description: "Save a hotel, restaurant, flight, or activity link for later recommendations.",
    icon: "->",
    category: "planning",
  },
  {
    command: "/recommend",
    usage: "[restaurant|hotel|activity] [keywords?]",
    example: "/recommend restaurant",
    purpose: "Recall remembered places before searching externally.",
    description: "Recommend places from the group's chat and shared links first.",
    icon: "~",
    category: "planning",
  },
  {
    command: "/track",
    usage: "[add <url>|run]",
    example: "/track add https://www.timeout.com/tokyo restaurant",
    purpose: "Follow websites or RSS feeds for travel updates.",
    description: "Follow a source for daily travel and restaurant updates.",
    icon: "RSS",
    category: "support",
  },
  {
    command: "/cancel",
    example: "/cancel",
    purpose: "Cancel the current active trip.",
    description: "Cancel the current active trip.",
    icon: "--",
    category: "trip",
  },
  {
    command: "/complete",
    example: "/complete",
    purpose: "Mark the current active trip complete.",
    description: "Close out the trip and send final settlement/feedback prompts.",
    icon: "END",
    category: "trip",
  },
  {
    command: "/delete-my-data",
    example: "/delete-my-data",
    purpose: "Request deletion of the caller's stored user data.",
    description: "Start personal data deletion for the LINE user who invokes it.",
    icon: "DEL",
    category: "privacy",
    helpVisible: false,
    rateLimitExempt: true,
  },
  {
    command: "/optout",
    example: "/optout",
    purpose: "Disable message parsing for the user.",
    description: "Stop TravelSync from parsing your messages for trip planning.",
    icon: "OFF",
    category: "privacy",
    rateLimitExempt: true,
  },
  {
    command: "/optin",
    example: "/optin",
    purpose: "Re-enable message parsing for the user.",
    description: "Re-enable message parsing after opting out.",
    icon: "ON",
    category: "privacy",
    rateLimitExempt: true,
  },
  {
    command: "/help",
    example: "/help",
    purpose: "Show the command list.",
    description: "Show available commands and examples.",
    icon: "?",
    category: "support",
    rateLimitExempt: true,
  },
] as const satisfies CommandCatalogEntry[];

export type CommandName = (typeof COMMAND_CATALOG)[number]["command"];

export const PUBLIC_COMMAND_CATALOG: readonly CommandCatalogEntry[] = COMMAND_CATALOG.filter(
  (entry: CommandCatalogEntry) => entry.helpVisible !== false
);

export function getCommandUsage(entry: CommandCatalogEntry): string {
  return entry.usage ? `${entry.command} ${entry.usage}` : entry.command;
}

export function getCommandCatalogEntry(command: string): CommandCatalogEntry | undefined {
  return COMMAND_CATALOG.find((entry) => entry.command === command);
}

export function buildBotHelpText(): string {
  const lines: string[] = ["TravelSync AI - Commands", ""];

  for (const entry of PUBLIC_COMMAND_CATALOG) {
    lines.push(getCommandUsage(entry));
    lines.push(`  ${entry.description}`);
    lines.push(`  Example: ${entry.example}`);
    lines.push("");
  }

  lines.push("Type /optout to stop me from parsing your messages.");

  return lines.join("\n");
}

export type CommandCatalogEntry = {
  command: string;
  usage?: string;
  example: string;
  description: string;
  emoji: string;
  liffVisible?: boolean;
};

export const COMMAND_CATALOG: CommandCatalogEntry[] = [
  {
    command: "/start",
    usage: "[destination?] [dates?]",
    example: "/start",
    description:
      "Start a new trip. Destination, dates, and participants can all be decided later — pass them now only if you already know.",
    emoji: "🚀",
    liffVisible: true,
  },
  {
    command: "/status",
    example: "/status",
    description: "Show the trip board grouped into To-Do, Pending, and Confirmed.",
    emoji: "📋",
    liffVisible: true,
  },
  {
    command: "/decide",
    usage: "[item]",
    example: "/decide restaurant",
    description: "Create a decision item so the group can vote on it later.",
    emoji: "🧭",
    liffVisible: true,
  },
  {
    command: "/vote",
    usage: "[item]",
    example: "/vote restaurant",
    description: "Start a vote for a decision item and post options for the group.",
    emoji: "🗳️",
    liffVisible: true,
  },
  {
    command: "/option",
    usage: "[decision-item] | [option-name]",
    example: "/option restaurant | Ramen Shop Osaka",
    description: "Add a voting option to a decision item so the group can vote on it.",
    emoji: "🔤",
    liffVisible: true,
  },
  {
    command: "/add",
    usage: "[item]",
    example: "/add Book travel insurance",
    description: "Add a planning item to the trip board.",
    emoji: "➕",
    liffVisible: true,
  },
  {
    command: "/share",
    usage: "[url]",
    example: "/share https://booking.com/hotel/xyz",
    description: "Save a hotel, restaurant, flight, or activity link as trip knowledge.",
    emoji: "🔗",
    liffVisible: true,
  },
  {
    command: "/recommend",
    usage: "[type]",
    example: "/recommend restaurant",
    description: "Recommend remembered places from the group's chat history first.",
    emoji: "✨",
    liffVisible: true,
  },
  {
    command: "/ready",
    example: "/ready",
    description: "Show a readiness summary using committed trip details only.",
    emoji: "✅",
    liffVisible: true,
  },
  {
    command: "/ops",
    example: "/ops",
    description: "Show the trip operations summary based on committed execution data.",
    emoji: "🛠️",
    liffVisible: true,
  },
  {
    command: "/incident",
    usage: "[what happened]",
    example: "/incident I lost my passport",
    description: "Open a verified incident playbook for disruptions like delays or lost documents.",
    emoji: "🚨",
    liffVisible: true,
  },
  {
    command: "/nudge",
    example: "/nudge",
    description: "Remind the group about pending votes or stale open items.",
    emoji: "🔔",
    liffVisible: true,
  },
  {
    command: "/exp",
    usage: "[amount] [description] [for @name1 @name2 | for all]",
    example: "/exp 1200 dinner for @Alice @Bob",
    description: "Record a payment and split it across selected members or the whole group.",
    emoji: "💰",
    liffVisible: true,
  },
  {
    command: "/exp-summary",
    example: "/exp-summary",
    description: "Show who owes whom and the minimum settlements needed.",
    emoji: "💸",
    liffVisible: true,
  },
  {
    command: "/budget",
    usage: "[amount] [currency?]",
    example: "/budget 50000 JPY",
    description: "Set or update the trip's total planned budget. Currency defaults to TWD.",
    emoji: "🎯",
    liffVisible: true,
  },
  {
    command: "/idea",
    usage: "[category?] [text]",
    example: "/idea restaurant Any ramen near Shinjuku",
    description: "Drop a brainstorm idea onto the trip idea board. Categories: destination, hotel, activity, restaurant, general.",
    emoji: "💡",
    liffVisible: true,
  },
  {
    command: "/ideas",
    example: "/ideas",
    description: "List all open brainstorm ideas for the active trip, grouped by category.",
    emoji: "📝",
    liffVisible: true,
  },
  {
    command: "/docs",
    usage: "add [type] [label?] [expires YYYY-MM-DD?] | list",
    example: "/docs add passport expires 2028-03-15",
    description: "Record and review travel documents (passport, visa, insurance) with expiry warnings.",
    emoji: "📑",
    liffVisible: true,
  },
  {
    command: "/pack",
    usage: "add [category?] [item] | list | check [#]",
    example: "/pack add clothing rain jacket",
    description: "Manage the group packing checklist. Categories: documents, clothing, toiletries, electronics, safety, general.",
    emoji: "🎒",
    liffVisible: true,
  },
  {
    command: "/confirm",
    usage: "[forwarded booking text]",
    example: "/confirm Booking confirmed! Ref AX-12345 Hotel Sunshine check-in July 15",
    description: "Parse a forwarded booking confirmation and mark the matching trip item as booked.",
    emoji: "📩",
    liffVisible: true,
  },
  {
    command: "/cancel",
    example: "/cancel",
    description: "Cancel the current active trip.",
    emoji: "🚫",
    liffVisible: true,
  },
  {
    command: "/complete",
    example: "/complete",
    description: "Mark the current active trip as complete.",
    emoji: "🏁",
    liffVisible: true,
  },
  {
    command: "/track",
    usage: "[add <url>|run]",
    example: "/track add https://www.timeout.com/tokyo restaurant",
    description: "Follow a website or RSS feed for daily travel & restaurant updates.",
    emoji: "📡",
    liffVisible: true,
  },
  {
    command: "/optout",
    example: "/optout",
    description: "Stop TravelSync from parsing your messages for trip planning.",
    emoji: "🔇",
    liffVisible: true,
  },
  {
    command: "/optin",
    example: "/optin",
    description: "Re-enable message parsing after opting out.",
    emoji: "🔊",
    liffVisible: true,
  },
  {
    command: "/help",
    example: "/help",
    description: "Show the full command list.",
    emoji: "❓",
    liffVisible: true,
  },
];

export function getCommandUsage(entry: CommandCatalogEntry): string {
  return entry.usage ? `${entry.command} ${entry.usage}` : entry.command;
}

export function buildBotHelpText(): string {
  const lines: string[] = ["TravelSync AI - Commands", ""];

  for (const entry of COMMAND_CATALOG) {
    lines.push(getCommandUsage(entry));
    lines.push(`  ${entry.description}`);
    lines.push(`  Example: ${entry.example}`);
    lines.push("");
  }

  lines.push("Type /optout to stop me from parsing your messages.");

  return lines.join("\n");
}

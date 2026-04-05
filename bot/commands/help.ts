const HELP_TEXT = `TravelSync AI — Commands

/start [destination] [dates]
  Start a new trip. Example: /start Osaka 7/15-7/20

/status
  Show the trip board (To-Do / Pending / Confirmed).

/vote [item]
  Start a vote for a board item. Example: /vote hotel

/add [item]
  Add a To-Do item. Example: /add Book travel insurance

/nudge
  Remind group members with pending votes or open items.

/help
  Show this message.

Type /optout to stop me from parsing your messages.`;

export async function handleHelp(reply: (text: string) => Promise<void>): Promise<void> {
  await reply(HELP_TEXT);
}

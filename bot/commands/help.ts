const HELP_TEXT = `TravelSync AI — Commands

/start [destination] [dates]
  Start a new trip. Example: /start Osaka 7/15-7/20

/status
  Show the trip board (To-Do / Pending / Confirmed).

/vote [item]
  Start a vote for a board item. Example: /vote hotel

/add [item]
  Add a To-Do item. Example: /add Book travel insurance

/share [url]
  Share a hotel, flight, restaurant, or activity link. I'll extract the details and add it to the board as a voteable option.
  Example: /share https://booking.com/hotel/xyz

/nudge
  Remind group members with pending votes or open items.

/exp [amount] [description] [for @name1 @name2 | for all]
  Record a payment. Split equally among named members or the whole group.
  Example: /exp 1200 dinner for @Alice @Bob

/exp-summary
  Show who owes who money and the minimum settlements needed.

/help
  Show this message.

Type /optout to stop me from parsing your messages.`;

export async function handleHelp(reply: (text: string) => Promise<void>): Promise<void> {
  await reply(HELP_TEXT);
}

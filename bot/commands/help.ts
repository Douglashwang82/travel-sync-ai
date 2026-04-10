const HELP_TEXT = `TravelSync AI — Commands

/start [destination] [dates]
  Start a new trip. Example: /start Osaka 7/15-7/20

/status
  Show the trip board (Knowledge / Pending / Confirmed).

── Knowledge Base ──────────────────

/add [place or note]
  Save an interesting place or event to the knowledge base.
  Example: /add Dotonbori ramen street

/share [url]
  Share a link. I'll extract the details and save it to the knowledge base.
  Example: /share https://booking.com/hotel/xyz

/plan
  Ask AI to suggest a day-by-day itinerary from your saved places.

── Group Decisions ──────────────────

/decide [type]
  Turn saved knowledge items into a group vote.
  Example: /decide restaurant  →  vote on all saved restaurants

/vote [item]
  Start a vote for an existing decision item.
  Example: /vote hotel

/nudge
  Remind group members with pending votes.

── Expenses ──────────────────

/exp [amount] [description] [for @name1 @name2 | for all]
  Record a payment. Example: /exp 1200 dinner for @Alice @Bob

/exp-summary
  Show who owes who and minimum settlements.

/help
  Show this message.

Type /optout to stop me from parsing your messages.`;

export async function handleHelp(reply: (text: string) => Promise<void>): Promise<void> {
  await reply(HELP_TEXT);
}

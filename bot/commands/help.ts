const HELP_TEXT = `TravelSync AI — Commands

/start [destination] [dates]
  Start a new trip. Example: /start Osaka 7/15-7/20

/status
  Show the trip board (To-Do / Pending / Confirmed).

/decide [item]
  Create a decision item for the group to choose later. Example: /decide restaurant

/vote [item]
  Start a vote for a decision item. Example: /vote restaurant

/add [item]
  Add a planning item. Example: /add Book travel insurance

/share [url]
  Share a hotel, flight, restaurant, or activity link. I'll remember it as trip knowledge for later recommendations or decisions.
  Example: /share https://booking.com/hotel/xyz

/recommend [type]
  Recommend remembered places from the group's chat history first.
  Example: /recommend restaurant

/ready
  Show a readiness summary using committed trip details only, with explicit unknowns for anything not yet confirmed.

/ops
  Show the batched trip operations command center summary using committed execution data only.

/incident [what happened]
  Experimental: open a verified incident playbook for travel disruptions like flight delay, lost passport, illness, or missed meetup.
  Example: /incident I lost my passport

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

"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

// ─── Data ─────────────────────────────────────────────────────────────────────

const COMMANDS = [
  {
    cmd: "/start [destination] [dates]",
    example: "/start Osaka Jul 15–20",
    desc: "Create a new group trip. Sets the destination and travel dates for the board.",
    emoji: "🚀",
  },
  {
    cmd: "/vote [item]",
    example: "/vote hotel",
    desc: "Start a visual vote on a board item. TravelSync fetches options and sends a Flex Message card for everyone to vote on.",
    emoji: "🗳️",
  },
  {
    cmd: "/add [item]",
    example: "/add book travel insurance",
    desc: "Manually add a to-do item to the trip board.",
    emoji: "➕",
  },
  {
    cmd: "/status",
    example: "/status",
    desc: "Print a summary of the trip board — item counts per stage and the list of items.",
    emoji: "📋",
  },
  {
    cmd: "/nudge",
    example: "/nudge",
    desc: "Remind the group about pending votes and open items that haven't been acted on.",
    emoji: "🔔",
  },
  {
    cmd: "/share [url]",
    example: "/share https://booking.com/...",
    desc: "Extract hotel/activity details from a booking link and add them to the vote options.",
    emoji: "🔗",
  },
  {
    cmd: "/exp [amount] [description]",
    example: "/exp 8400 dinner for all",
    desc: "Log a shared expense. Split equally by default. Add 'for @Alice @Bob' to split among specific people.",
    emoji: "💰",
  },
  {
    cmd: "/exp-summary",
    example: "/exp-summary",
    desc: "Show the bill-splitting summary — who owes whom and how much.",
    emoji: "💸",
  },
  {
    cmd: "/optout",
    example: "/optout",
    desc: "Stop TravelSync from parsing your messages for travel info. Use /optin to re-enable.",
    emoji: "🔇",
  },
  {
    cmd: "/help",
    example: "/help",
    desc: "Show the command list in the group chat.",
    emoji: "❓",
  },
];

const FAQ = [
  {
    q: "Does everyone need to download an app?",
    a: "No. TravelSync lives entirely inside LINE. All members interact through the group chat — nothing to install.",
  },
  {
    q: "How does AI parsing work?",
    a: "TravelSync reads travel-related messages (hotels, dates, preferences) and automatically adds them to the trip board as to-do items.",
  },
  {
    q: "Who is the organizer?",
    a: "The member who typed /start becomes the organizer. They can reopen or delete items on the board.",
  },
  {
    q: "How are votes closed?",
    a: "Votes close automatically when a majority is reached, or when the deadline passes. The winner is announced in chat and confirmed on the board.",
  },
  {
    q: "Is my data private?",
    a: "Raw messages are kept for 7 days only. Parsed trip data is kept for 90 days after the trip ends. Use /optout to stop message parsing.",
  },
];

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function HelpPage() {
  const [expandedFaq, setExpandedFaq] = useState<number | null>(null);

  return (
    <div className="max-w-md mx-auto">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-[var(--background)] border-b border-[var(--border)] px-4 py-3">
        <h1 className="font-bold text-base">❓ Help</h1>
        <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
          TravelSync AI — group travel co-pilot
        </p>
      </div>

      <div className="px-4 pt-4 pb-4 space-y-6">
        {/* Commands */}
        <section>
          <h2 className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wide mb-3 px-1">
            Commands
          </h2>
          <div className="rounded-2xl border border-[var(--border)] divide-y divide-[var(--border)] overflow-hidden">
            {COMMANDS.map((c) => (
              <div key={c.cmd} className="px-4 py-3 flex items-start gap-3">
                <span className="text-lg shrink-0 mt-0.5">{c.emoji}</span>
                <div className="flex-1 min-w-0">
                  <code className="text-xs font-mono font-bold text-[var(--primary)]">
                    {c.cmd.split(" ")[0]}
                  </code>
                  <p className="text-xs font-mono text-[var(--muted-foreground)] mt-0.5">
                    {c.example}
                  </p>
                  <p className="text-xs text-[var(--muted-foreground)] mt-1 leading-relaxed">
                    {c.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* FAQ */}
        <section>
          <h2 className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wide mb-3 px-1">
            FAQ
          </h2>
          <div className="rounded-2xl border border-[var(--border)] divide-y divide-[var(--border)] overflow-hidden">
            {FAQ.map((item, i) => (
              <div key={i}>
                <button
                  className="w-full flex items-center justify-between px-4 py-3 text-left"
                  onClick={() => setExpandedFaq(expandedFaq === i ? null : i)}
                >
                  <span className="text-sm font-medium pr-3">{item.q}</span>
                  <span
                    className={cn(
                      "text-[var(--muted-foreground)] text-sm shrink-0 transition-transform",
                      expandedFaq === i && "rotate-180"
                    )}
                  >
                    ▾
                  </span>
                </button>
                {expandedFaq === i && (
                  <div className="px-4 pb-3">
                    <p className="text-sm text-[var(--muted-foreground)] leading-relaxed">
                      {item.a}
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* Privacy */}
        <section>
          <h2 className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wide mb-3 px-1">
            Privacy
          </h2>
          <div className="rounded-2xl border border-[var(--border)] p-4">
            <p className="text-xs text-[var(--muted-foreground)] leading-relaxed">
              TravelSync AI only reads travel-related messages to build your trip
              board. Raw messages are retained for{" "}
              <strong className="text-[var(--foreground)]">7 days</strong> only.
              Parsed trip data is kept for{" "}
              <strong className="text-[var(--foreground)]">90 days</strong> after
              the trip ends. Type{" "}
              <code className="font-mono text-xs bg-[var(--secondary)] px-1 py-0.5 rounded">
                /optout
              </code>{" "}
              in the group chat to stop processing your messages at any time.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { COMMAND_CATALOG, getCommandUsage } from "@/lib/command-catalog";
import { cn } from "@/lib/utils";

const FAQ = [
  {
    q: "Does everyone need to download an app?",
    a: "No. TravelSync lives entirely inside LINE. All members interact through the group chat and LIFF pages, with nothing extra to install.",
  },
  {
    q: "How does AI parsing work?",
    a: "TravelSync reads travel-related messages like hotels, dates, and preferences and automatically turns useful planning details into trip items.",
  },
  {
    q: "Who is the organizer?",
    a: "The member who typed /start becomes the organizer. They can reopen or delete items on the board.",
  },
  {
    q: "How are votes closed?",
    a: "Votes close automatically when a majority is reached or when the deadline passes. The winner is announced in chat and confirmed on the board.",
  },
  {
    q: "Is my data private?",
    a: "Raw messages are kept for 7 days only. Parsed trip data is kept for 90 days after the trip ends. Use /optout to stop message parsing.",
  },
];

const COMMANDS = COMMAND_CATALOG.filter((entry) => entry.liffVisible !== false);

export default function HelpPage() {
  const [expandedFaq, setExpandedFaq] = useState<number | null>(null);

  return (
    <div className="max-w-md mx-auto">
      <div className="sticky top-0 z-10 bg-[var(--background)] border-b border-[var(--border)] px-4 py-3">
        <h1 className="font-bold text-base">Help</h1>
        <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
          TravelSync AI - group travel co-pilot
        </p>
      </div>

      <div className="px-4 pt-4 pb-4 space-y-6">
        <section>
          <h2 className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wide mb-3 px-1">
            Commands
          </h2>
          <p className="text-xs text-[var(--muted-foreground)] mb-3 px-1 leading-relaxed">
            This list is generated from the same command catalog used by the bot&apos;s
            `/help` reply, so the LIFF help page stays aligned with the actual chat commands.
          </p>
          <div className="rounded-2xl border border-[var(--border)] divide-y divide-[var(--border)] overflow-hidden">
            {COMMANDS.map((command) => (
              <div key={command.command} className="px-4 py-3 flex items-start gap-3">
                <span className="text-lg shrink-0 mt-0.5">{command.emoji}</span>
                <div className="flex-1 min-w-0">
                  <code className="text-xs font-mono font-bold text-[var(--primary)]">
                    {command.command}
                  </code>
                  <p className="text-xs font-mono text-[var(--foreground)] mt-0.5 break-words">
                    {getCommandUsage(command)}
                  </p>
                  <p className="text-xs font-mono text-[var(--muted-foreground)] mt-0.5 break-words">
                    {command.example}
                  </p>
                  <p className="text-xs text-[var(--muted-foreground)] mt-1 leading-relaxed">
                    {command.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2 className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wide mb-3 px-1">
            FAQ
          </h2>
          <div className="rounded-2xl border border-[var(--border)] divide-y divide-[var(--border)] overflow-hidden">
            {FAQ.map((item, index) => (
              <div key={item.q}>
                <button
                  className="w-full flex items-center justify-between px-4 py-3 text-left"
                  onClick={() => setExpandedFaq(expandedFaq === index ? null : index)}
                >
                  <span className="text-sm font-medium pr-3">{item.q}</span>
                  <span
                    className={cn(
                      "text-[var(--muted-foreground)] text-sm shrink-0 transition-transform",
                      expandedFaq === index && "rotate-180"
                    )}
                  >
                    ▼
                  </span>
                </button>
                {expandedFaq === index && (
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

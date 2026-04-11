"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
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
    <div className="mx-auto max-w-md">
      <div className="sticky top-0 z-10 border-b border-[var(--border)] bg-[var(--background)] px-4 py-3">
        <h1 className="text-base font-bold">Help</h1>
        <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
          TravelSync AI - group travel co-pilot
        </p>
      </div>

      <div className="space-y-6 px-4 pb-4 pt-4">
        <section>
          <h2 className="mb-3 px-1 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
            LIFF Views
          </h2>
          <div className="space-y-3 rounded-2xl border border-[var(--border)] p-4">
            <p className="text-sm leading-relaxed text-[var(--muted-foreground)]">
              Use the LIFF views together: board for planning, votes for decisions,
              itinerary for confirmed plans, readiness for blockers, and operations for
              the live execution summary.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm" variant="outline">
                <Link href="/liff/dashboard">Board</Link>
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link href="/liff/readiness">Readiness</Link>
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link href="/liff/operations">Operations</Link>
              </Button>
            </div>
          </div>
        </section>

        <section>
          <h2 className="mb-3 px-1 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
            Commands
          </h2>
          <p className="mb-3 px-1 text-xs leading-relaxed text-[var(--muted-foreground)]">
            This list is generated from the same command catalog used by the bot&apos;s
            `/help` reply, so the LIFF help page stays aligned with the actual chat
            commands.
          </p>
          <div className="overflow-hidden rounded-2xl border border-[var(--border)] divide-y divide-[var(--border)]">
            {COMMANDS.map((command) => (
              <div key={command.command} className="flex items-start gap-3 px-4 py-3">
                <span className="mt-0.5 shrink-0 text-lg">{command.emoji}</span>
                <div className="min-w-0 flex-1">
                  <code className="text-xs font-bold text-[var(--primary)]">
                    {command.command}
                  </code>
                  <p className="mt-0.5 break-words font-mono text-xs text-[var(--foreground)]">
                    {getCommandUsage(command)}
                  </p>
                  <p className="mt-0.5 break-words font-mono text-xs text-[var(--muted-foreground)]">
                    {command.example}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-[var(--muted-foreground)]">
                    {command.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2 className="mb-3 px-1 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
            FAQ
          </h2>
          <div className="overflow-hidden rounded-2xl border border-[var(--border)] divide-y divide-[var(--border)]">
            {FAQ.map((item, index) => (
              <div key={item.q}>
                <button
                  className="flex w-full items-center justify-between px-4 py-3 text-left"
                  onClick={() => setExpandedFaq(expandedFaq === index ? null : index)}
                >
                  <span className="pr-3 text-sm font-medium">{item.q}</span>
                  <span
                    className={cn(
                      "shrink-0 text-sm text-[var(--muted-foreground)] transition-transform",
                      expandedFaq === index && "rotate-180"
                    )}
                  >
                    v
                  </span>
                </button>
                {expandedFaq === index ? (
                  <div className="px-4 pb-3">
                    <p className="text-sm leading-relaxed text-[var(--muted-foreground)]">
                      {item.a}
                    </p>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2 className="mb-3 px-1 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
            Privacy
          </h2>
          <div className="rounded-2xl border border-[var(--border)] p-4">
            <p className="text-xs leading-relaxed text-[var(--muted-foreground)]">
              TravelSync AI only reads travel-related messages to build your trip
              board. Raw messages are retained for{" "}
              <strong className="text-[var(--foreground)]">7 days</strong> only.
              Parsed trip data is kept for{" "}
              <strong className="text-[var(--foreground)]">90 days</strong> after
              the trip ends. Type{" "}
              <code className="rounded bg-[var(--secondary)] px-1 py-0.5 font-mono text-xs">
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

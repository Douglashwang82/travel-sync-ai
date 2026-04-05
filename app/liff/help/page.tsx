"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

const COMMANDS = [
  { cmd: "/start [destination] [dates]", desc: "Start a new trip. E.g. /start Osaka 7/15-7/20" },
  { cmd: "/status", desc: "Show the trip board (To-Do / Pending / Confirmed)" },
  { cmd: "/vote [item]", desc: "Start a vote for a board item. E.g. /vote hotel" },
  { cmd: "/add [item]", desc: "Add a To-Do item manually" },
  { cmd: "/nudge", desc: "Remind the group about pending votes and open items" },
  { cmd: "/help", desc: "Show the command list" },
];

export default function HelpPage() {
  return (
    <div className="max-w-md mx-auto p-4 space-y-4 pt-6">
      <div>
        <h1 className="text-xl font-bold">✈️ TravelSync AI</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Your group trip planning co-pilot, right inside LINE.
        </p>
      </div>

      <Separator />

      <Card>
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-sm font-semibold">Commands</CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-3">
          {COMMANDS.map(({ cmd, desc }) => (
            <div key={cmd}>
              <p className="text-xs font-mono font-medium">{cmd}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-sm font-semibold">Privacy</CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <p className="text-xs text-muted-foreground">
            TravelSync AI parses travel-related messages to help plan your trip.
            Raw messages are retained for 7 days only. Parsed trip data is kept
            for 90 days after the trip ends. Type{" "}
            <span className="font-mono">/optout</span> in the group chat to stop
            processing your messages.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

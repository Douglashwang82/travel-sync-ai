import Link from "next/link";
import { Button } from "@/components/ui/button";

// Web wizard for trip generation. See design/trip-generation.md.
//
// Final shape: 8-step single-question-per-screen wizard with hero imagery
// on step 1, pill multi-select on the vibe step, and a submit that POSTs
// to /api/app/trips/generate then redirects to /app/trips/[tripId].
//
// Stub until the survey state + generator land.

export const metadata = {
  title: "Plan a new trip — TravelSync",
  description: "Answer a few must-haves and we'll draft your trip.",
};

export default function NewTripPage() {
  return (
    <main className="mx-auto flex min-h-[70vh] max-w-2xl flex-col items-center justify-center gap-8 px-6 py-16 text-center">
      <p className="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">
        Coming soon
      </p>
      <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
        Plan a trip in eight questions.
      </h1>
      <p className="max-w-prose text-balance text-lg text-muted-foreground">
        Tell us your destination, dates, vibe, and must-haves. We'll draft a
        day-by-day skeleton you can edit on the bento workspace.
      </p>
      <Button asChild size="lg">
        <Link href="/app">Back to trips</Link>
      </Button>
    </main>
  );
}

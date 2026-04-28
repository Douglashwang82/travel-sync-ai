"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  BoardSkeleton,
  LoadingSpinner,
  ErrorScreen,
  EmptyState,
} from "@/components/liff/shared";
import { useLiff } from "@/components/liff-provider";
import { liffFetch } from "@/lib/liff-client";
import { toLiffErrorMessage } from "@/lib/liff-errors";
import type { LiffTripSummary, LiffTripsResponse } from "@/app/api/liff/trips/route";

export default function DashboardPage() {
  const { isReady, isLoggedIn, error } = useLiff();
  const [trips, setTrips] = useState<LiffTripSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadTrips = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await liffFetch("/api/liff/trips");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: LiffTripsResponse = await res.json();
      setTrips(data.trips);
    } catch (err) {
      setLoadError(
        toLiffErrorMessage(
          "trips",
          err,
          "We could not load your trips. Pull to refresh or reopen this page in LINE."
        )
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isReady || !isLoggedIn) return;
    void loadTrips();
  }, [isReady, isLoggedIn, loadTrips]);

  if (!isReady) return <LoadingSpinner message="Initializing..." />;
  if (error) return <ErrorScreen message={error} />;
  if (!isLoggedIn) return <LoadingSpinner message="Logging in..." />;
  if (loading && !trips) return <BoardSkeleton />;
  if (loadError) return <ErrorScreen message={loadError} onRetry={loadTrips} />;

  const safeTrips = trips ?? [];
  const active = safeTrips.filter((t) => t.status === "active" || t.status === "draft");
  const past = safeTrips.filter((t) => t.status !== "active" && t.status !== "draft");

  if (safeTrips.length === 0) {
    return (
      <EmptyState
        emoji="Trip"
        title="No trips yet"
        description={
          <>
            Type{" "}
            <code className="font-mono bg-[var(--secondary)] px-1 py-0.5 rounded text-xs">
              /start
            </code>{" "}
            in a LINE group with TravelSync to begin planning. New trips will
            show up here automatically.
          </>
        }
      />
    );
  }

  return (
    <div className="max-w-md mx-auto px-4 pt-4 pb-6 space-y-5">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-lg font-bold">Your trips</h1>
          <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
            Every trip across your LINE groups, in one place.
          </p>
        </div>
        <p className="text-[11px] text-[var(--muted-foreground)] shrink-0">
          {safeTrips.length} total
        </p>
      </header>

      {active.length > 0 && (
        <Section title="Active & drafts">
          <TripList trips={active} />
        </Section>
      )}

      {past.length > 0 && (
        <Section title="Past trips">
          <TripList trips={past} dim />
        </Section>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
        {title}
      </h2>
      {children}
    </section>
  );
}

function TripList({ trips, dim = false }: { trips: LiffTripSummary[]; dim?: boolean }) {
  return (
    <ul className="space-y-2">
      {trips.map((t) => (
        <li key={t.id}>
          <TripCard trip={t} dim={dim} />
        </li>
      ))}
    </ul>
  );
}

function TripCard({ trip, dim }: { trip: LiffTripSummary; dim: boolean }) {
  const dateLabel =
    trip.startDate && trip.endDate
      ? `${formatDate(trip.startDate)} → ${formatDate(trip.endDate)}`
      : "Dates TBD";

  return (
    <Link
      href={`/liff/trips/${trip.id}`}
      className={`flex items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--background)] px-4 py-3 transition-colors hover:border-[var(--primary)] active:bg-[var(--secondary)] ${
        dim ? "opacity-70" : ""
      }`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <p className="truncate text-sm font-semibold">
            {trip.destinationName ?? "Untitled trip"}
          </p>
          <StatusPill status={trip.status} />
        </div>
        <p className="mt-0.5 truncate text-[11px] text-[var(--muted-foreground)]">
          {trip.groupName ?? "LINE group"} · {dateLabel}
        </p>
        <p className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">
          {trip.itemCount} item{trip.itemCount === 1 ? "" : "s"}
        </p>
      </div>
      <span className="text-[var(--muted-foreground)] text-sm shrink-0">{">"}</span>
    </Link>
  );
}

function StatusPill({ status }: { status: string }) {
  const cls =
    status === "active"
      ? "bg-[#dcfce7] text-[#166534] dark:bg-[#14532d] dark:text-[#86efac]"
      : status === "draft"
        ? "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-200"
        : "bg-[var(--secondary)] text-[var(--muted-foreground)]";
  return (
    <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold capitalize ${cls}`}>
      {status}
    </span>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

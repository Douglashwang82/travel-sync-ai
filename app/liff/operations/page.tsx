"use client";

import { useCallback, useEffect, useState } from "react";
import {
  EmptyState,
  ErrorScreen,
  InlineError,
  ListSkeleton,
  LoadingSpinner,
} from "@/components/liff/shared";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { liffFetch } from "@/lib/liff-client";
import { toLiffErrorMessage } from "@/lib/liff-errors";
import { useLiffSession } from "@/lib/use-liff-session";

type OperationsSummary = {
  tripId: string;
  destinationName: string;
  phase: "planning" | "countdown" | "departure" | "active" | "return" | "complete";
  headline: string;
  nextActions: string[];
  activeRisks: string[];
  transportStatus: string[];
  confirmedToday: string[];
  readiness: {
    completionPercent: number;
    confidenceScore: number;
    blockerCount: number;
  };
  sourceOfTruth: string[];
  freshness: {
    generatedAt: string;
    degraded: boolean;
    notes: string[];
  };
};

export default function OperationsPage() {
  const {
    isReady,
    isLoggedIn,
    error,
    session,
    sessionLoading,
    sessionError,
    reloadSession,
  } = useLiffSession();
  const [summary, setSummary] = useState<OperationsSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);

    try {
      const sessionData = await reloadSession();
      if (!sessionData) throw new Error("Failed to load session");

      if (!sessionData.activeTrip) {
        setSummary(null);
        return;
      }

      const opsRes = await liffFetch(
        `/api/liff/operations?tripId=${encodeURIComponent(sessionData.activeTrip.id)}`
      );
      if (!opsRes.ok) throw new Error("Failed to load operations");

      setSummary(await opsRes.json());
    } catch (err) {
      setLoadError(
        toLiffErrorMessage(
          "operations",
          err,
          "We could not load trip operations right now. Reopen this page in LINE and try again."
        )
      );
    } finally {
      setLoading(false);
    }
  }, [reloadSession]);

  useEffect(() => {
    if (!isReady || !isLoggedIn || !session || sessionLoading) return;

    if (!session.activeTrip) {
      setSummary(null);
      return;
    }

    void (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const opsRes = await liffFetch(
          `/api/liff/operations?tripId=${encodeURIComponent(session.activeTrip!.id)}`
        );
        if (!opsRes.ok) throw new Error("Failed to load operations");
        setSummary(await opsRes.json());
      } catch (err) {
        setLoadError(
          toLiffErrorMessage(
            "operations",
            err,
            "We could not load trip operations right now. Reopen this page in LINE and try again."
          )
        );
      } finally {
        setLoading(false);
      }
    })();
  }, [isReady, isLoggedIn, session, sessionLoading]);

  if (!isReady) return <LoadingSpinner message="Initializing..." />;
  if (error) return <ErrorScreen message={error} />;
  if (!isLoggedIn) return <LoadingSpinner message="Logging in..." />;
  if (sessionLoading && !session) return <ListSkeleton rows={4} />;
  if (sessionError && !session) return <ErrorScreen message={sessionError} onRetry={load} />;
  if (loading) return <ListSkeleton rows={4} />;
  if (loadError) return <ErrorScreen message={loadError} onRetry={load} />;

  if (!summary || !session?.activeTrip) {
    return (
      <EmptyState
        emoji="Ops"
        title="No operations data yet"
        description="Start a trip and commit key transport or stay details before using the operations command center."
      />
    );
  }

  return (
    <div className="max-w-md mx-auto">
      <div className="sticky top-0 z-10 bg-[var(--background)]/95 backdrop-blur-sm border-b border-[var(--border)] px-4 py-3">
        <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
          Trip Operations
        </p>
        <h1 className="font-bold text-base mt-1">{summary.destinationName}</h1>
        <p className="text-xs text-[var(--muted-foreground)] mt-1">{summary.headline}</p>
      </div>

      {summary.freshness.degraded && (
        <InlineError message="Operations data is partial. This view only reflects committed trip data and explicit unknowns." />
      )}

      <div className="px-4 pt-4 pb-4 space-y-4">
        <section className="rounded-2xl border border-[var(--border)] bg-[var(--secondary)] p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
                Current Phase
              </p>
              <h2 className="text-lg font-semibold capitalize mt-1">{summary.phase}</h2>
            </div>
            <div className="text-right">
              <p className="text-xs text-[var(--muted-foreground)]">Readiness</p>
              <p className="text-lg font-semibold">{summary.readiness.completionPercent}%</p>
              <p className="text-xs text-[var(--muted-foreground)]">
                {summary.readiness.confidenceScore}% confidence
              </p>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-[var(--border)] p-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Readiness companion</p>
            <p className="text-xs text-[var(--muted-foreground)] mt-1">
              Jump to the readiness checklist for blocker-level detail.
            </p>
          </div>
          <Button asChild size="sm" variant="outline">
            <Link href="/liff/readiness">Open readiness</Link>
          </Button>
        </section>

        <SectionCard title="Next Actions" items={summary.nextActions} empty="No immediate actions from committed data." />
        <SectionCard title="Active Risks" items={summary.activeRisks} empty="No major risks detected from committed data." />
        <SectionCard title="Committed Source of Truth" items={summary.sourceOfTruth} empty="No committed execution details yet." />
        <SectionCard title="Transport Status" items={summary.transportStatus} empty="No committed transport found." />
        <SectionCard title="Confirmed Items" items={summary.confirmedToday} empty="No confirmed execution items yet." />
        <SectionCard title="Freshness Notes" items={summary.freshness.notes} empty="No freshness notes." />
      </div>
    </div>
  );
}

function SectionCard({
  title,
  items,
  empty,
}: {
  title: string;
  items: string[];
  empty: string;
}) {
  return (
    <section className="rounded-2xl border border-[var(--border)] overflow-hidden">
      <div className="px-4 py-2.5 bg-[var(--secondary)] border-b border-[var(--border)]">
        <h2 className="font-medium text-sm">{title}</h2>
      </div>
      <div className="px-4 py-3">
        {items.length > 0 ? (
          <ul className="space-y-2 text-sm text-[var(--foreground)]">
            {items.map((item) => (
              <li key={item} className="leading-relaxed">
                - {item}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-[var(--muted-foreground)]">{empty}</p>
        )}
      </div>
    </section>
  );
}

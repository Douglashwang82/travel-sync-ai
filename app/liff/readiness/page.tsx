"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  EmptyState,
  ErrorScreen,
  InlineError,
  ListSkeleton,
  LoadingSpinner,
} from "@/components/liff/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { liffFetch } from "@/lib/liff-client";
import { toLiffErrorMessage } from "@/lib/liff-errors";
import { useLiffSession } from "@/lib/use-liff-session";
import { cn } from "@/lib/utils";

type ReadinessSeverity = "low" | "medium" | "high" | "critical";
type ReadinessStatus = "open" | "completed" | "dismissed" | "unknown";
type ReadinessCategory =
  | "documents"
  | "reservations"
  | "transport"
  | "money"
  | "packing"
  | "meetup"
  | "return";

type ReadinessItem = {
  id: string;
  tripId: string;
  category: ReadinessCategory;
  title: string;
  description: string | null;
  severity: ReadinessSeverity;
  status: ReadinessStatus;
  dueAt: string | null;
  sourceKind: "system" | "manual" | "incident";
  evidence: string[];
};

type ReadinessSnapshot = {
  tripId: string;
  trip: {
    destinationName: string;
    startDate: string | null;
    endDate: string | null;
  };
  confidenceScore: number;
  completionPercent: number;
  blockers: ReadinessItem[];
  items: ReadinessItem[];
  missingInputs: string[];
  committedSourceSummary: string[];
};

const STATUS_META: Record<ReadinessStatus, { label: string; className: string }> = {
  completed: {
    label: "Completed",
    className: "border-transparent bg-[#dcfce7] text-[#166534]",
  },
  open: {
    label: "Needs Action",
    className: "border-transparent bg-amber-100 text-amber-700",
  },
  unknown: {
    label: "Unknown",
    className: "border-transparent bg-[var(--secondary)] text-[var(--muted-foreground)]",
  },
  dismissed: {
    label: "Dismissed",
    className: "border-transparent bg-slate-100 text-slate-600",
  },
};

const SEVERITY_META: Record<ReadinessSeverity, { label: string; className: string }> = {
  critical: {
    label: "Critical",
    className: "border-transparent bg-red-100 text-red-700",
  },
  high: {
    label: "High",
    className: "border-transparent bg-orange-100 text-orange-700",
  },
  medium: {
    label: "Medium",
    className: "border-transparent bg-yellow-100 text-yellow-700",
  },
  low: {
    label: "Low",
    className: "border-transparent bg-sky-100 text-sky-700",
  },
};

const CATEGORY_LABELS: Record<ReadinessCategory, string> = {
  documents: "Documents",
  reservations: "Reservations",
  transport: "Transport",
  money: "Money",
  packing: "Packing",
  meetup: "Meetup",
  return: "Return",
};

export default function ReadinessPage() {
  const {
    isReady,
    isLoggedIn,
    error,
    session,
    sessionLoading,
    sessionError,
    reloadSession,
  } = useLiffSession();
  const [snapshot, setSnapshot] = useState<ReadinessSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);

    try {
      const sessionData = await reloadSession();
      if (!sessionData) {
        throw new Error("Failed to load session");
      }

      if (!sessionData.activeTrip) {
        setSnapshot(null);
        return;
      }

      const readinessRes = await liffFetch(
        `/api/liff/readiness?tripId=${encodeURIComponent(sessionData.activeTrip.id)}`
      );

      if (!readinessRes.ok) {
        throw new Error("Failed to load readiness");
      }

      setSnapshot(await readinessRes.json());
    } catch (err) {
      setLoadError(
        toLiffErrorMessage(
          "readiness",
          err,
          "We could not load the readiness checklist. Reopen this page in LINE and try again."
        )
      );
    } finally {
      setLoading(false);
    }
  }, [reloadSession]);

  useEffect(() => {
    if (!isReady || !isLoggedIn || !session || sessionLoading) {
      return;
    }

    if (!session.activeTrip) {
      setSnapshot(null);
      return;
    }

    void (async () => {
      setLoading(true);
      setLoadError(null);

      try {
        const readinessRes = await liffFetch(
          `/api/liff/readiness?tripId=${encodeURIComponent(session.activeTrip.id)}`
        );

        if (!readinessRes.ok) {
          throw new Error("Failed to load readiness");
        }

        setSnapshot(await readinessRes.json());
      } catch (err) {
        setLoadError(
          toLiffErrorMessage(
            "readiness",
            err,
            "We could not load the readiness checklist. Reopen this page in LINE and try again."
          )
        );
      } finally {
        setLoading(false);
      }
    })();
  }, [isReady, isLoggedIn, session, sessionLoading]);

  if (!isReady) {
    return <LoadingSpinner message="Initializing..." />;
  }

  if (error) {
    return <ErrorScreen message={error} />;
  }

  if (!isLoggedIn) {
    return <LoadingSpinner message="Logging in..." />;
  }

  if (sessionLoading && !session) {
    return <ListSkeleton rows={5} />;
  }

  if (sessionError && !session) {
    return <ErrorScreen message={sessionError} onRetry={load} />;
  }

  if (loading) {
    return <ListSkeleton rows={5} />;
  }

  if (loadError) {
    return <ErrorScreen message={loadError} onRetry={load} />;
  }

  if (!snapshot || !session?.activeTrip) {
    return (
      <EmptyState
        emoji="🧳"
        title="No readiness snapshot yet"
        description="Start a trip and confirm core travel items before using the readiness checklist."
      />
    );
  }

  const unknownCount = snapshot.items.filter((item) => item.status === "unknown").length;
  const openCount = snapshot.items.filter((item) => item.status === "open").length;

  return (
    <div className="mx-auto max-w-md">
      <div className="sticky top-0 z-10 border-b border-[var(--border)] bg-[var(--background)]/95 px-4 py-3 backdrop-blur-sm">
        <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
          Readiness
        </p>
        <h1 className="mt-1 text-base font-bold">{snapshot.trip.destinationName}</h1>
        <p className="mt-1 text-xs text-[var(--muted-foreground)]">
          {formatDateRange(snapshot.trip.startDate, snapshot.trip.endDate)}
        </p>
      </div>

      {snapshot.blockers.length > 0 ? (
        <InlineError
          message={`${snapshot.blockers.length} blocker${snapshot.blockers.length === 1 ? "" : "s"} still need attention before this trip is fully ready.`}
        />
      ) : null}

      <div className="space-y-4 px-4 pb-4 pt-4">
        <section className="rounded-2xl bg-[var(--primary)] p-5 text-white">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-medium opacity-80">Trip readiness</p>
              <p className="mt-1 text-3xl font-bold">{snapshot.completionPercent}%</p>
              <p className="mt-1 text-xs opacity-75">
                {snapshot.items.length} checks | {snapshot.blockers.length} blocker
                {snapshot.blockers.length === 1 ? "" : "s"}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs opacity-80">Confidence</p>
              <p className="mt-1 text-2xl font-semibold">{snapshot.confidenceScore}%</p>
            </div>
          </div>

          <div className="mt-4 space-y-2">
            <ProgressRow label="Completed" value={snapshot.completionPercent} />
            <ProgressRow label="Confidence" value={snapshot.confidenceScore} />
          </div>
        </section>

        <section className="grid grid-cols-3 gap-3">
          <MetricCard label="Blockers" value={snapshot.blockers.length} tone="danger" />
          <MetricCard label="Open" value={openCount} tone="warning" />
          <MetricCard label="Unknown" value={unknownCount} tone="muted" />
        </section>

        <section className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--border)] p-4">
          <div>
            <p className="text-sm font-medium">Operations overview</p>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">
              Switch to the trip operations summary for the big-picture view.
            </p>
          </div>
          <Button asChild size="sm" variant="outline">
            <Link href="/liff/operations">Open ops</Link>
          </Button>
        </section>

        <SectionCard title="Priority Blockers">
          {snapshot.blockers.length > 0 ? (
            <div className="space-y-3">
              {snapshot.blockers.map((item) => (
                <ReadinessItemCard key={item.id} item={item} emphasized />
              ))}
            </div>
          ) : (
            <EmptySection message="No critical or high-severity blockers are currently unresolved." />
          )}
        </SectionCard>

        <SectionCard title="Missing Inputs">
          {snapshot.missingInputs.length > 0 ? (
            <ul className="space-y-2">
              {snapshot.missingInputs.map((input) => (
                <li key={input} className="text-sm leading-relaxed text-[var(--foreground)]">
                  {input}
                </li>
              ))}
            </ul>
          ) : (
            <EmptySection message="No major missing inputs detected from the current committed trip data." />
          )}
        </SectionCard>

        <SectionCard title="Committed Source of Truth">
          {snapshot.committedSourceSummary.length > 0 ? (
            <ul className="space-y-2">
              {snapshot.committedSourceSummary.map((entry) => (
                <li key={entry} className="text-sm leading-relaxed text-[var(--foreground)]">
                  {entry}
                </li>
              ))}
            </ul>
          ) : (
            <EmptySection message="No committed trip details are available yet." />
          )}
        </SectionCard>

        <section className="overflow-hidden rounded-2xl border border-[var(--border)]">
          <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--secondary)] px-4 py-2.5">
            <h2 className="text-sm font-medium">All Checks</h2>
            <Badge variant="secondary" className="text-xs">
              Read-only
            </Badge>
          </div>
          <div className="space-y-3 p-4">
            {snapshot.items.map((item) => (
              <ReadinessItemCard key={item.id} item={item} />
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-[var(--border)] bg-[var(--secondary)] p-4">
          <p className="text-sm leading-relaxed text-[var(--muted-foreground)]">
            This readiness view is currently generated from committed trip data only.
            Checklist editing and manual confirmations are not implemented yet.
          </p>
          <Button variant="outline" size="sm" className="mt-3 w-full" onClick={load}>
            Refresh snapshot
          </Button>
        </section>
      </div>
    </div>
  );
}

function SectionCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-[var(--border)]">
      <div className="border-b border-[var(--border)] bg-[var(--secondary)] px-4 py-2.5">
        <h2 className="text-sm font-medium">{title}</h2>
      </div>
      <div className="px-4 py-3">{children}</div>
    </section>
  );
}

function MetricCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "danger" | "warning" | "muted";
}) {
  const toneClass =
    tone === "danger"
      ? "border-red-200 bg-red-50 text-red-700"
      : tone === "warning"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : "border-[var(--border)] bg-[var(--card)] text-[var(--foreground)]";

  return (
    <div className={cn("rounded-2xl border p-3", toneClass)}>
      <p className="text-xs uppercase tracking-wide opacity-80">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
    </div>
  );
}

function ProgressRow({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="flex items-center justify-between text-xs opacity-85">
        <span>{label}</span>
        <span>{value}%</span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-white/20">
        <div
          className="h-full rounded-full bg-white transition-all"
          style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
        />
      </div>
    </div>
  );
}

function ReadinessItemCard({
  item,
  emphasized = false,
}: {
  item: ReadinessItem;
  emphasized?: boolean;
}) {
  const statusMeta = STATUS_META[item.status];
  const severityMeta = SEVERITY_META[item.severity];

  return (
    <div
      className={cn(
        "rounded-2xl border p-4",
        emphasized
          ? "border-red-200 bg-red-50/60"
          : "border-[var(--border)] bg-[var(--card)]"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
            {CATEGORY_LABELS[item.category]}
          </p>
          <h3 className="mt-1 text-sm font-semibold leading-snug">{item.title}</h3>
        </div>
        <div className="shrink-0 flex flex-col items-end gap-1">
          <Badge className={cn("text-[10px]", severityMeta.className)}>
            {severityMeta.label}
          </Badge>
          <Badge className={cn("text-[10px]", statusMeta.className)}>
            {statusMeta.label}
          </Badge>
        </div>
      </div>

      {item.description ? (
        <p className="mt-3 text-sm leading-relaxed text-[var(--muted-foreground)]">
          {item.description}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <Badge variant="outline" className="text-[10px]">
          Source: {item.sourceKind}
        </Badge>
        {item.dueAt ? (
          <Badge variant="outline" className="text-[10px]">
            Due: {formatDate(item.dueAt)}
          </Badge>
        ) : null}
      </div>

      {item.evidence.length > 0 ? (
        <div className="mt-3">
          <p className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">
            Evidence
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {item.evidence.map((entry) => (
              <span
                key={entry}
                className="rounded-full bg-[var(--secondary)] px-2.5 py-1 text-[11px] text-[var(--foreground)]"
              >
                {entry}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function EmptySection({ message }: { message: string }) {
  return <p className="text-sm leading-relaxed text-[var(--muted-foreground)]">{message}</p>;
}

function formatDate(value: string | null): string {
  if (!value) {
    return "Unknown";
  }

  return new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function formatDateRange(startDate: string | null, endDate: string | null): string {
  if (startDate && endDate) {
    return `${startDate} -> ${endDate}`;
  }

  if (startDate) {
    return `Starts ${startDate}`;
  }

  if (endDate) {
    return `Ends ${endDate}`;
  }

  return "Trip dates not committed yet";
}

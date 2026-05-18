"use client";

import { useCallback, useState } from "react";
import { appFetchJson } from "@/lib/app-client";
import { GridTileError } from "@/components/app/grids/grid-tile";
import type {
  PlanMasterReview,
  PlanMasterSuggestion,
} from "@/app/api/app/trips/[tripId]/plan-master/route";

interface BucketTone {
  label: string;
  icon: string;
  border: string;
  text: string;
  bg: string;
}

const BUCKETS: Record<keyof Omit<PlanMasterReview, "summary" | "readiness" | "generatedAt">, BucketTone> = {
  mustHave: {
    label: "Must have",
    icon: "★",
    border: "border-[var(--status-blocked)]",
    text: "text-[var(--status-blocked)]",
    bg: "bg-[var(--status-blocked-soft)]",
  },
  whatNext: {
    label: "What's next",
    icon: "→",
    border: "border-[var(--accent-line)]",
    text: "text-[var(--accent-line)]",
    bg: "bg-[var(--accent-line-soft)]",
  },
  watchOut: {
    label: "Watch out",
    icon: "!",
    border: "border-[var(--status-needs-decision)]",
    text: "text-[var(--status-needs-decision)]",
    bg: "bg-[var(--status-needs-decision-soft)]",
  },
  onTrack: {
    label: "On track",
    icon: "✓",
    border: "border-[var(--status-settled)]",
    text: "text-[var(--status-settled)]",
    bg: "bg-[var(--status-settled-soft)]",
  },
};

const BUCKET_KEYS: Array<keyof typeof BUCKETS> = [
  "mustHave",
  "whatNext",
  "watchOut",
  "onTrack",
];

export function PlanMasterGrid({ tripId }: { tripId: string }) {
  const [review, setReview] = useState<PlanMasterReview | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    setRunning(true);
    setError(null);
    try {
      const res = await appFetchJson<{ review: PlanMasterReview }>(
        `/api/app/trips/${tripId}/plan-master`,
        { method: "POST" },
      );
      setReview(res.review);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate review");
    } finally {
      setRunning(false);
    }
  }, [tripId]);

  if (error) {
    return (
      <GridTileError
        message={error}
        onRetry={() => {
          setError(null);
          void run();
        }}
      />
    );
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <Header
        review={review}
        running={running}
        onRun={run}
      />

      {!review && !running && (
        <div className="flex flex-1 items-center justify-center rounded-md border border-dashed border-[var(--border-hairline)] p-4 text-center text-xs text-[var(--text-muted)]">
          Click <strong className="px-1">Review trip</strong> for an AI plan-master summary with must-haves and next steps.
        </div>
      )}

      {running && !review && (
        <div className="flex flex-1 items-center justify-center rounded-md border border-dashed border-[var(--border-hairline)] p-4 text-center text-xs text-[var(--text-muted)]">
          Reviewing all trip content…
        </div>
      )}

      {review && (
        <>
          {review.summary && (
            <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
              {review.summary}
            </p>
          )}

          <div className="grid flex-1 grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
            {BUCKET_KEYS.map((key) => (
              <Bucket key={key} tone={BUCKETS[key]} items={review[key]} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Header({
  review,
  running,
  onRun,
}: {
  review: PlanMasterReview | null;
  running: boolean;
  onRun: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-2 text-[11px] text-[var(--text-muted)]">
      <div className="min-w-0">
        <div className="truncate font-medium text-[var(--text-secondary)]">
          Trip plan master
        </div>
        <div className="truncate">
          {review
            ? `Last reviewed ${formatRelative(review.generatedAt)}`
            : "AI review of every item, idea, and vote"}
        </div>
        {review && <ReadinessChip readiness={review.readiness} />}
      </div>
      <button
        type="button"
        disabled={running}
        onClick={onRun}
        className="shrink-0 rounded-md border border-[var(--border-hairline)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] disabled:opacity-50"
      >
        {running ? "Reviewing…" : review ? "Re-review" : "Review trip"}
      </button>
    </div>
  );
}

function ReadinessChip({ readiness }: { readiness: number }) {
  const tone =
    readiness >= 75
      ? "bg-[var(--status-settled-soft)] text-[var(--status-settled)]"
      : readiness >= 40
        ? "bg-[var(--status-needs-decision-soft)] text-[var(--status-needs-decision)]"
        : "bg-[var(--status-blocked-soft)] text-[var(--status-blocked)]";
  return (
    <div className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${tone}`}>
      Readiness {readiness}%
    </div>
  );
}

function Bucket({ tone, items }: { tone: BucketTone; items: PlanMasterSuggestion[] }) {
  return (
    <div className={`flex flex-col gap-1 rounded-md border ${tone.border} ${tone.bg} px-2.5 py-2`}>
      <div className={`flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide ${tone.text}`}>
        <span>{tone.icon}</span>
        <span>{tone.label}</span>
        <span className="ml-auto opacity-60">{items.length}</span>
      </div>
      {items.length === 0 ? (
        <div className="text-[11px] text-[var(--text-faint)]">—</div>
      ) : (
        <ul className="space-y-1">
          {items.map((s, i) => (
            <li key={i} className="text-[11px] leading-snug text-[var(--text-secondary)]">
              <div className="font-medium">{s.text}</div>
              {s.why && (
                <div className="mt-0.5 text-[10px] text-[var(--text-muted)]">{s.why}</div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

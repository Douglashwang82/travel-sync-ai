"use client";

import { useEffect, useState } from "react";
import { useAppLocale } from "@/components/app/app-locale-provider";
import { StreamingText } from "@/components/app/chat/streaming-text";
import { appFetchJson } from "@/lib/app-client";
import type { TripDeltaResponse } from "@/app/api/app/trips/[tripId]/delta/route";

const LAST_VISIT_KEY = (tripId: string) => `trip-delta-last-visit:${tripId}`;
const SESSION_KEY = (tripId: string) => `trip-delta-session:${tripId}`;

const COPY = {
  en: {
    lead: "While you were away",
    proposals: (n: number) => `${n} new AI ${n === 1 ? "proposal" : "proposals"}`,
    pending: (n: number) => `${n} awaiting your review`,
    autoApplied: (n: number) => `${n} auto-applied (undoable)`,
    expenses: (n: number, total: string) => `${n} ${n === 1 ? "expense" : "expenses"} (${total})`,
    agentRuns: (n: number) => `${n} agent ${n === 1 ? "run" : "runs"}`,
    joiner: " · ",
  },
  "zh-TW": {
    lead: "你不在的這段時間",
    proposals: (n: number) => `${n} 則新的 AI 建議`,
    pending: (n: number) => `${n} 則待你審核`,
    autoApplied: (n: number) => `${n} 則已自動套用(可復原)`,
    expenses: (n: number, total: string) => `新增 ${n} 筆支出(${total})`,
    agentRuns: (n: number) => `代理執行 ${n} 次`,
    joiner: " · ",
  },
} as const;

/**
 * The "what changed since I left" strip under the trip hero. Computes `since`
 * from the previous visit (localStorage, refreshed once per browser session)
 * and renders a single streamed sentence summarizing AI proposals, applied
 * actions, expenses, and agent runs. Renders nothing when nothing happened —
 * silence is the zero state, not an empty box.
 */
export function TripDeltaStrip({ tripId }: { tripId: string }) {
  const { locale } = useAppLocale();
  const copy = COPY[locale];
  const [delta, setDelta] = useState<TripDeltaResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let since: string | null = null;
      try {
        // One stable `since` per browser session so a mid-session refresh
        // doesn't wipe the strip; the next session sees changes from now on.
        since = sessionStorage.getItem(SESSION_KEY(tripId));
        if (!since) {
          since = localStorage.getItem(LAST_VISIT_KEY(tripId));
          if (since) sessionStorage.setItem(SESSION_KEY(tripId), since);
          localStorage.setItem(LAST_VISIT_KEY(tripId), new Date().toISOString());
        }
      } catch {
        // Private mode etc. — fall back to the API's default window.
      }
      try {
        const qs = since ? `?since=${encodeURIComponent(since)}` : "";
        const res = await appFetchJson<TripDeltaResponse>(
          `/api/app/trips/${tripId}/delta${qs}`,
        );
        if (!cancelled) setDelta(res);
      } catch {
        // Non-critical surface: fail silent, never block the workspace.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tripId]);

  if (!delta) return null;

  const segments: string[] = [];
  if (delta.aiProposals.count > 0) segments.push(copy.proposals(delta.aiProposals.count));
  if (delta.actions.pending > 0) segments.push(copy.pending(delta.actions.pending));
  if (delta.actions.autoApplied > 0) segments.push(copy.autoApplied(delta.actions.autoApplied));
  if (delta.expenses.count > 0) {
    const total = `${delta.expenses.currency} ${Math.round(delta.expenses.total).toLocaleString()}`;
    segments.push(copy.expenses(delta.expenses.count, total));
  }
  if (delta.agentRuns.count > 0) segments.push(copy.agentRuns(delta.agentRuns.count));

  if (segments.length === 0) return null;

  return (
    <aside
      id="trip-delta-strip"
      aria-label={copy.lead}
      className="glass-1 mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-[var(--radius-lg)] px-4 py-2.5"
    >
      <span
        id="trip-delta-strip-lead"
        className="text-editorial text-sm text-[var(--text-primary)]"
      >
        {copy.lead}
      </span>
      <span
        id="trip-delta-strip-body"
        className="min-w-0 text-xs text-[var(--text-secondary)]"
      >
        <StreamingText text={segments.join(copy.joiner)} stream />
      </span>
    </aside>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { appFetchJson } from "@/lib/app-client";

interface PulseState {
  pendingReason: string | null;
  lastSummary: string | null;
  lastRunAt: string | null;
}

interface ApiShape {
  orchestrator: PulseState;
}

/**
 * Workspace-level status pulse for the per-trip orchestrator. Polls the
 * orchestrator GET endpoint at a slow rate; when an auto-chain is in flight
 * (pendingReason starting with "auto-chain") it renders a small "Working…"
 * pill so the user can see background activity from either mode. Clicking
 * the pill switches the workspace to Orchestrator mode via the supplied
 * callback. Stays mounted across mode switches so polling never drops.
 */
export function TripOrchestratorPulse({
  tripId,
  onOpen,
}: {
  tripId: string;
  onOpen: () => void;
}) {
  const [state, setState] = useState<PulseState | null>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function tick() {
      if (cancelled.current) return;
      try {
        const res = await appFetchJson<ApiShape>(`/api/app/trips/${tripId}/orchestrator`);
        if (!cancelled.current) setState(res.orchestrator);
      } catch {
        // Transient — keep ticking.
      }
      if (cancelled.current) return;
      // Fast cadence while chaining, slow cadence otherwise.
      const chaining = (state?.pendingReason ?? "").startsWith("auto-chain");
      timer = setTimeout(tick, chaining ? 5_000 : 15_000);
    }

    void tick();
    return () => {
      cancelled.current = true;
      if (timer) clearTimeout(timer);
    };
  }, [tripId, state?.pendingReason]);

  const chaining = state?.pendingReason?.startsWith("auto-chain") ?? false;
  if (!chaining) return null;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="inline-flex items-center gap-1.5 rounded-full border border-[var(--accent-line)] bg-[var(--surface-base)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--accent-line)] hover:bg-[var(--accent-line)] hover:text-[var(--surface-base)]"
      title={state?.pendingReason ?? "Orchestrator is working"}
    >
      <span aria-hidden className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-current" />
      <span>Orchestrator working…</span>
      <style>{`
        @keyframes orch-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%      { opacity: 0.35; transform: scale(0.75); }
        }
        .pulse-dot { animation: orch-pulse 1.2s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .pulse-dot { animation: none; }
        }
      `}</style>
    </button>
  );
}

"use client";

import { useEffect, useState } from "react";
import { TripBentoPage } from "@/components/app/trip-bento-page";
import { TripOrchestratorMode } from "@/components/app/trip-orchestrator-mode";

type WorkspaceMode = "bento" | "orchestrator";

const STORAGE_PREFIX = "trip-workspace-mode:";

function storageKey(tripId: string) {
  return `${STORAGE_PREFIX}${tripId}`;
}

function readMode(tripId: string): WorkspaceMode {
  if (typeof window === "undefined") return "bento";
  try {
    const v = window.localStorage.getItem(storageKey(tripId));
    return v === "orchestrator" ? "orchestrator" : "bento";
  } catch {
    return "bento";
  }
}

/**
 * Trip workspace shell. Renders a mode toggle between the bento grid (the
 * panoramic, every-feature view) and Orchestrator mode (single-goal +
 * structural plan). Mode persists per trip in localStorage.
 */
export function TripWorkspace({ tripId }: { tripId: string }) {
  // Always start in "bento" on first render so SSR + first client paint
  // agree; hydrate the stored choice in an effect.
  const [mode, setMode] = useState<WorkspaceMode>("bento");

  useEffect(() => {
    setMode(readMode(tripId));
  }, [tripId]);

  const switchMode = (next: WorkspaceMode) => {
    setMode(next);
    try {
      window.localStorage.setItem(storageKey(tripId), next);
    } catch {
      // Non-fatal — private mode etc.
    }
  };

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-2">
        <span className="text-caps text-[10px] text-[var(--text-muted)]">Workspace</span>
        <div
          role="tablist"
          aria-label="Workspace mode"
          className="inline-flex rounded-full border border-[var(--border-hairline)] bg-[var(--surface-base)] p-0.5 text-[10px] font-semibold uppercase tracking-wide"
        >
          <ModeButton
            label="Bento"
            active={mode === "bento"}
            onClick={() => switchMode("bento")}
          />
          <ModeButton
            label="Orchestrator"
            active={mode === "orchestrator"}
            onClick={() => switchMode("orchestrator")}
          />
        </div>
      </div>

      {mode === "bento" ? (
        <TripBentoPage tripId={tripId} />
      ) : (
        <TripOrchestratorMode tripId={tripId} />
      )}
    </>
  );
}

function ModeButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      role="tab"
      aria-selected={active}
      type="button"
      onClick={onClick}
      className={
        active
          ? "rounded-full bg-[var(--accent-line)] px-3 py-1 text-[var(--surface-base)]"
          : "rounded-full px-3 py-1 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
      }
    >
      {label}
    </button>
  );
}

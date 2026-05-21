"use client";

import { useCallback, useSyncExternalStore } from "react";
import { useSearchParams } from "next/navigation";
import { TripBentoPage } from "@/components/app/trip-bento-page";
import { TripOrchestratorMode } from "@/components/app/trip-orchestrator-mode";

type WorkspaceMode = "bento" | "orchestrator";

const STORAGE_PREFIX = "trip-workspace-mode:";
const STORAGE_EVENT = "trip-workspace-mode:change";

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

function parseUrlMode(raw: string | undefined | null): WorkspaceMode | null {
  return raw === "bento" || raw === "orchestrator" ? raw : null;
}

function subscribeToStorage(callback: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(STORAGE_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(STORAGE_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

/**
 * Trip workspace shell. Renders a mode toggle between the bento grid (the
 * panoramic, every-feature view) and Orchestrator mode (single-goal +
 * structural plan). Mode persists per trip in localStorage; a `?mode=` query
 * param wins over storage so deep-links from Orchestrator-task outcome chips
 * land in the right view.
 */
export function TripWorkspace({ tripId }: { tripId: string }) {
  const searchParams = useSearchParams();
  const urlMode = parseUrlMode(searchParams?.get("mode"));

  // `?mode=` (if present) wins over storage so deep-links land where they
  // should. Storage is the user's previous toggle choice; we read it through
  // `useSyncExternalStore` so changes from the toggle propagate immediately.
  const getSnapshot = useCallback(() => readMode(tripId), [tripId]);
  const getServerSnapshot = useCallback<() => WorkspaceMode>(() => "bento", []);
  const storedMode = useSyncExternalStore(subscribeToStorage, getSnapshot, getServerSnapshot);
  const mode: WorkspaceMode = urlMode ?? storedMode;

  const switchMode = (next: WorkspaceMode) => {
    try {
      window.localStorage.setItem(storageKey(tripId), next);
      window.dispatchEvent(new Event(STORAGE_EVENT));
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

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { appFetchJson } from "@/lib/app-client";
import { GridTileError, GridTileSkeleton } from "@/components/app/grids/grid-tile";

type Autonomy = "propose_only" | "auto_apply_with_undo" | "auto_apply";
type ActionStatus = "pending" | "applied" | "auto_applied" | "dismissed" | "undone" | "failed";

interface OrchestratorState {
  id: string;
  enabled: boolean;
  systemGoal: string | null;
  scheduleMinutes: number;
  toolAutonomy: Record<string, Autonomy>;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastStatus: string | null;
  lastSummary: string | null;
  lastError: string | null;
  pendingReason: string | null;
  consecutiveFailures: number;
}

interface ToolMeta {
  name: string;
  description: string;
  grid: string;
  defaultAutonomy: Autonomy;
}

interface ActionRow {
  id: string;
  tool: string;
  input: Record<string, unknown>;
  result: Record<string, unknown> | null;
  rationale: string | null;
  status: ActionStatus;
  autonomy: Autonomy;
  createdAt: string;
  decidedAt: string | null;
}

interface ApiResponse {
  orchestrator: OrchestratorState;
  tools: ToolMeta[];
  agents: Array<{ type: string; label: string; description: string }>;
  actions: ActionRow[];
}

/**
 * Bento tile for the per-trip Orchestrator. Shows status, pending proposals
 * (ghost lane), recent applied actions (with undo), and a config drawer for
 * per-tool autonomy and a free-text goal.
 */
export function OrchestratorGrid({ tripId }: { tripId: string }) {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [reason, setReason] = useState("");
  const [tab, setTab] = useState<"pending" | "recent" | "settings">("pending");

  const load = useCallback(async () => {
    try {
      const res = await appFetchJson<ApiResponse>(`/api/app/trips/${tripId}/orchestrator`);
      setData(res);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    }
  }, [tripId]);

  useEffect(() => {
    void load();
  }, [load]);

  const runNow = useCallback(async () => {
    setRunning(true);
    try {
      await appFetchJson(`/api/app/trips/${tripId}/orchestrator/run`, {
        method: "POST",
        body: JSON.stringify({ reason: reason || undefined }),
        headers: { "Content-Type": "application/json" },
      });
      setReason("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Run failed");
    } finally {
      setRunning(false);
    }
  }, [tripId, reason, load]);

  const decide = useCallback(
    async (actionId: string, decision: "confirm" | "dismiss" | "undo") => {
      try {
        await appFetchJson(`/api/app/trips/${tripId}/orchestrator/actions/${actionId}`, {
          method: "POST",
          body: JSON.stringify({ decision }),
          headers: { "Content-Type": "application/json" },
        });
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Decision failed");
      }
    },
    [tripId, load],
  );

  const toggleEnabled = useCallback(async () => {
    if (!data) return;
    try {
      const res = await appFetchJson<{ orchestrator: OrchestratorState }>(
        `/api/app/trips/${tripId}/orchestrator`,
        {
          method: "PATCH",
          body: JSON.stringify({ enabled: !data.orchestrator.enabled }),
          headers: { "Content-Type": "application/json" },
        },
      );
      setData({ ...data, orchestrator: { ...data.orchestrator, ...res.orchestrator } });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Toggle failed");
    }
  }, [tripId, data]);

  const updateAutonomy = useCallback(
    async (tool: string, autonomy: Autonomy) => {
      if (!data) return;
      const next = { ...data.orchestrator.toolAutonomy, [tool]: autonomy };
      try {
        await appFetchJson(`/api/app/trips/${tripId}/orchestrator`, {
          method: "PATCH",
          body: JSON.stringify({ toolAutonomy: next }),
          headers: { "Content-Type": "application/json" },
        });
        setData({
          ...data,
          orchestrator: { ...data.orchestrator, toolAutonomy: next },
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Update failed");
      }
    },
    [tripId, data],
  );

  const updateGoal = useCallback(
    async (goal: string) => {
      if (!data) return;
      try {
        await appFetchJson(`/api/app/trips/${tripId}/orchestrator`, {
          method: "PATCH",
          body: JSON.stringify({ systemGoal: goal || null }),
          headers: { "Content-Type": "application/json" },
        });
        setData({
          ...data,
          orchestrator: { ...data.orchestrator, systemGoal: goal || null },
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Update failed");
      }
    },
    [tripId, data],
  );

  const pending = useMemo(() => data?.actions.filter((a) => a.status === "pending") ?? [], [data]);
  const recent = useMemo(
    () => data?.actions.filter((a) => a.status !== "pending").slice(0, 20) ?? [],
    [data],
  );

  if (error && !data) return <GridTileError message={error} onRetry={() => void load()} />;
  if (!data) return <GridTileSkeleton />;

  const o = data.orchestrator;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <header className="flex items-start justify-between gap-2 text-[11px] text-[var(--text-muted)]">
        <div className="min-w-0">
          <div className="truncate font-medium text-[var(--text-secondary)]">
            {o.enabled ? "Active" : "Paused"}
            {o.lastStatus ? ` · last ${o.lastStatus}` : ""}
          </div>
          <div className="truncate">
            {o.lastSummary ??
              (o.nextRunAt ? `next run ${formatRelative(o.nextRunAt)}` : "awaiting first run")}
          </div>
        </div>
        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            onClick={toggleEnabled}
            className="rounded-full border border-[var(--border-hairline)] px-2 py-0.5 text-[10px] uppercase tracking-wide hover:border-[var(--border-strong)]"
            title={o.enabled ? "Pause orchestrator" : "Resume orchestrator"}
          >
            {o.enabled ? "Pause" : "Resume"}
          </button>
        </div>
      </header>

      <div className="flex gap-1 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
        {(["pending", "recent", "settings"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`rounded-full px-2 py-0.5 ${
              tab === t
                ? "bg-[var(--surface-pressed)] text-[var(--text-primary)]"
                : "hover:text-[var(--text-secondary)]"
            }`}
          >
            {t === "pending" ? `Pending (${pending.length})` : t === "recent" ? "Recent" : "Settings"}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {tab === "pending" && (
          <PendingList items={pending} onDecide={decide} />
        )}
        {tab === "recent" && <RecentList items={recent} onDecide={decide} />}
        {tab === "settings" && (
          <Settings
            orchestrator={o}
            tools={data.tools}
            onAutonomyChange={updateAutonomy}
            onGoalChange={updateGoal}
          />
        )}
      </div>

      <footer className="flex gap-2 border-t border-[var(--border-hairline)] pt-2">
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Tell the orchestrator…"
          className="min-w-0 flex-1 rounded-md border border-[var(--border-hairline)] bg-transparent px-2 py-1 text-xs"
        />
        <button
          type="button"
          onClick={runNow}
          disabled={running || !o.enabled}
          className="rounded-md bg-[var(--accent-line)] px-3 py-1 text-xs font-medium text-[var(--surface-base)] disabled:opacity-50"
        >
          {running ? "Running…" : "Run"}
        </button>
      </footer>

      {error && (
        <div className="text-[10px] text-[var(--status-blocked)]">{error}</div>
      )}
    </div>
  );
}

// ─── sub-components ──────────────────────────────────────────────────────────

function PendingList({
  items,
  onDecide,
}: {
  items: ActionRow[];
  onDecide: (id: string, d: "confirm" | "dismiss" | "undo") => void;
}) {
  if (items.length === 0) {
    return (
      <p className="py-6 text-center text-xs text-[var(--text-muted)]">
        No pending proposals.
      </p>
    );
  }
  return (
    <ul className="space-y-2">
      {items.map((a) => (
        <li
          key={a.id}
          className="rounded-md border border-[var(--border-hairline)] bg-[var(--surface-base)] p-2 text-xs"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="font-mono text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
                {a.tool}
              </div>
              <div className="mt-0.5 truncate text-[var(--text-primary)]">
                {a.rationale ?? "(no preview)"}
              </div>
            </div>
            <div className="flex shrink-0 gap-1">
              <button
                type="button"
                onClick={() => onDecide(a.id, "confirm")}
                className="rounded-md bg-[var(--accent-line)] px-2 py-0.5 text-[10px] font-medium text-[var(--surface-base)]"
              >
                Confirm
              </button>
              <button
                type="button"
                onClick={() => onDecide(a.id, "dismiss")}
                className="rounded-md border border-[var(--border-hairline)] px-2 py-0.5 text-[10px]"
              >
                Dismiss
              </button>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function RecentList({
  items,
  onDecide,
}: {
  items: ActionRow[];
  onDecide: (id: string, d: "confirm" | "dismiss" | "undo") => void;
}) {
  if (items.length === 0) {
    return (
      <p className="py-6 text-center text-xs text-[var(--text-muted)]">
        No recent actions.
      </p>
    );
  }
  return (
    <ul className="space-y-1">
      {items.map((a) => (
        <li
          key={a.id}
          className="flex items-start justify-between gap-2 rounded-md border border-transparent px-2 py-1 text-[11px] hover:border-[var(--border-hairline)]"
        >
          <div className="min-w-0">
            <div className="flex items-center gap-1 font-mono text-[10px] uppercase text-[var(--text-muted)]">
              <StatusDot status={a.status} />
              <span>{a.tool}</span>
              <span className="text-[var(--text-muted)]">· {formatRelative(a.createdAt)}</span>
            </div>
            <div className="truncate text-[var(--text-secondary)]">{a.rationale}</div>
          </div>
          {a.status === "applied" && (
            <button
              type="button"
              onClick={() => onDecide(a.id, "undo")}
              className="shrink-0 rounded-md border border-[var(--border-hairline)] px-2 py-0.5 text-[10px]"
              title="Undo this action"
            >
              Undo
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

function Settings({
  orchestrator,
  tools,
  onAutonomyChange,
  onGoalChange,
}: {
  orchestrator: OrchestratorState;
  tools: ToolMeta[];
  onAutonomyChange: (tool: string, autonomy: Autonomy) => void;
  onGoalChange: (goal: string) => void;
}) {
  const [draftGoal, setDraftGoal] = useState(orchestrator.systemGoal ?? "");
  const grouped = useMemo(() => {
    const g = new Map<string, ToolMeta[]>();
    for (const t of tools) {
      const list = g.get(t.grid) ?? [];
      list.push(t);
      g.set(t.grid, list);
    }
    return Array.from(g.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [tools]);

  return (
    <div className="space-y-3 text-xs">
      <div>
        <label className="mb-1 block text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
          Goal
        </label>
        <textarea
          value={draftGoal}
          onChange={(e) => setDraftGoal(e.target.value)}
          onBlur={() => {
            if ((orchestrator.systemGoal ?? "") !== draftGoal) onGoalChange(draftGoal);
          }}
          placeholder="What should the orchestrator focus on for this trip?"
          rows={2}
          className="w-full rounded-md border border-[var(--border-hairline)] bg-transparent px-2 py-1 text-xs"
        />
      </div>

      <div>
        <div className="mb-1 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
          Per-tool autonomy
        </div>
        <div className="space-y-2">
          {grouped.map(([grid, list]) => (
            <details key={grid} className="rounded-md border border-[var(--border-hairline)]">
              <summary className="cursor-pointer px-2 py-1 text-[11px] font-medium capitalize text-[var(--text-secondary)]">
                {grid} ({list.length})
              </summary>
              <ul className="divide-y divide-[var(--border-hairline)] px-2 pb-1">
                {list.map((t) => {
                  const current = orchestrator.toolAutonomy[t.name] ?? t.defaultAutonomy;
                  return (
                    <li key={t.name} className="flex items-center justify-between gap-2 py-1">
                      <div className="min-w-0">
                        <div className="font-mono text-[10px]">{t.name}</div>
                        <div className="truncate text-[10px] text-[var(--text-muted)]">
                          {t.description}
                        </div>
                      </div>
                      <select
                        value={current}
                        onChange={(e) => onAutonomyChange(t.name, e.target.value as Autonomy)}
                        className="shrink-0 rounded-md border border-[var(--border-hairline)] bg-transparent px-1 py-0.5 text-[10px]"
                      >
                        <option value="propose_only">Propose</option>
                        <option value="auto_apply_with_undo">Apply (undo)</option>
                        <option value="auto_apply">Apply</option>
                      </select>
                    </li>
                  );
                })}
              </ul>
            </details>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatusDot({ status }: { status: ActionStatus }) {
  const color =
    status === "applied" || status === "auto_applied"
      ? "var(--status-ok)"
      : status === "failed"
      ? "var(--status-blocked)"
      : status === "dismissed" || status === "undone"
      ? "var(--text-muted)"
      : "var(--accent-line)";
  return (
    <span
      aria-hidden
      className="inline-block h-1.5 w-1.5 rounded-full"
      style={{ background: color }}
    />
  );
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  if (diff < 0) {
    const fwd = Math.abs(diff);
    if (fwd < 60_000) return "soon";
    if (fwd < 3_600_000) return `in ${Math.round(fwd / 60_000)}m`;
    return `in ${Math.round(fwd / 3_600_000)}h`;
  }
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
  return `${Math.round(diff / 86_400_000)}d ago`;
}

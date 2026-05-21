"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { appFetchJson } from "@/lib/app-client";
import { GridTileError, GridTileSkeleton } from "@/components/app/grids/grid-tile";
import type { PlanTaskLink, TripPlan } from "@/services/orchestrator/types";

interface OrchestratorState {
  id: string;
  enabled: boolean;
  systemGoal: string | null;
  scheduleMinutes: number;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastStatus: string | null;
  lastSummary: string | null;
  lastError: string | null;
}

interface ApiResponse {
  orchestrator: OrchestratorState;
  plan: TripPlan | null;
  actions: Array<{ id: string; status: string }>;
}

/**
 * Orchestrator mode of the trip workspace. Focuses on a single goal and the
 * trip's structural plan (LLM-generated categories with user-completable
 * tasks). Sibling mode of the bento grid.
 */
export function TripOrchestratorMode({ tripId }: { tripId: string }) {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [goalDraft, setGoalDraft] = useState("");
  const [goalEditing, setGoalEditing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await appFetchJson<ApiResponse>(`/api/app/trips/${tripId}/orchestrator`);
      setData(res);
      setGoalDraft(res.orchestrator.systemGoal ?? "");
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    }
  }, [tripId]);

  useEffect(() => {
    void load();
  }, [load]);

  const pendingCount = useMemo(
    () => (data?.actions ?? []).filter((a) => a.status === "pending").length,
    [data],
  );

  const totals = useMemo(() => {
    const plan = data?.plan;
    if (!plan) return { tasks: 0, done: 0 };
    let tasks = 0;
    let done = 0;
    for (const c of plan.categories) {
      tasks += c.tasks.length;
      done += c.tasks.filter((t) => t.done).length;
    }
    return { tasks, done };
  }, [data]);

  const saveGoal = useCallback(async () => {
    if (!data) return;
    const next = goalDraft.trim();
    if ((data.orchestrator.systemGoal ?? "") === next) {
      setGoalEditing(false);
      return;
    }
    try {
      await appFetchJson(`/api/app/trips/${tripId}/orchestrator`, {
        method: "PATCH",
        body: JSON.stringify({ systemGoal: next || null }),
        headers: { "Content-Type": "application/json" },
      });
      setData({ ...data, orchestrator: { ...data.orchestrator, systemGoal: next || null } });
      setGoalEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save goal");
    }
  }, [tripId, data, goalDraft]);

  const runNow = useCallback(
    async (reason: string) => {
      setRunning(true);
      try {
        await appFetchJson(`/api/app/trips/${tripId}/orchestrator/run`, {
          method: "POST",
          body: JSON.stringify({ reason }),
          headers: { "Content-Type": "application/json" },
        });
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Run failed");
      } finally {
        setRunning(false);
      }
    },
    [tripId, load],
  );

  const toggleTask = useCallback(
    async (categoryId: string, taskId: string, done: boolean) => {
      if (!data?.plan) return;
      // Optimistic update.
      const optimistic: TripPlan = {
        ...data.plan,
        categories: data.plan.categories.map((c) =>
          c.id !== categoryId
            ? c
            : { ...c, tasks: c.tasks.map((t) => (t.id === taskId ? { ...t, done } : t)) },
        ),
      };
      setData({ ...data, plan: optimistic });
      try {
        const res = await appFetchJson<{ plan: TripPlan }>(
          `/api/app/trips/${tripId}/orchestrator/plan`,
          {
            method: "PATCH",
            body: JSON.stringify({ categoryId, taskId, done }),
            headers: { "Content-Type": "application/json" },
          },
        );
        setData((prev) => (prev ? { ...prev, plan: res.plan } : prev));
      } catch (err) {
        // Roll back.
        setData((prev) => (prev ? { ...prev, plan: data.plan } : prev));
        setError(err instanceof Error ? err.message : "Toggle failed");
      }
    },
    [tripId, data],
  );

  if (error && !data) return <GridTileError message={error} onRetry={() => void load()} />;
  if (!data) return <GridTileSkeleton />;

  const goal = data.orchestrator.systemGoal?.trim() ?? "";
  const plan = data.plan;

  return (
    <div className="space-y-6">
      {/* Goal hero */}
      <section className="rounded-[var(--radius-lg)] border border-[var(--border-hairline)] bg-[var(--surface-raised)] p-5">
        <div className="text-caps mb-2 text-[10px] text-[var(--text-muted)]">Goal</div>
        {goalEditing ? (
          <div className="space-y-2">
            <textarea
              autoFocus
              value={goalDraft}
              onChange={(e) => setGoalDraft(e.target.value)}
              placeholder="What should the orchestrator focus on for this trip?"
              rows={3}
              className="w-full rounded-md border border-[var(--border-hairline)] bg-transparent px-3 py-2 text-base leading-relaxed text-[var(--text-primary)]"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={saveGoal}
                className="rounded-md bg-[var(--accent-line)] px-3 py-1 text-xs font-medium text-[var(--surface-base)]"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => {
                  setGoalDraft(goal);
                  setGoalEditing(false);
                }}
                className="rounded-md border border-[var(--border-hairline)] px-3 py-1 text-xs"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setGoalEditing(true)}
            className="block w-full rounded-md text-left text-lg leading-snug text-[var(--text-primary)] hover:text-[var(--accent-line)]"
            title="Click to edit"
          >
            {goal || (
              <span className="text-[var(--text-muted)]">
                Click to set the goal — the orchestrator will plan around it.
              </span>
            )}
          </button>
        )}
      </section>

      {/* Plan */}
      <section>
        <div className="mb-3 flex items-end justify-between gap-2">
          <div>
            <div className="text-caps text-[10px] text-[var(--text-muted)]">Plan</div>
            <div className="text-sm text-[var(--text-secondary)]">
              {plan
                ? `${plan.categories.length} categories · ${totals.done}/${totals.tasks} tasks complete`
                : "No plan yet"}
            </div>
          </div>
          <button
            type="button"
            onClick={() => void runNow(plan ? "Update the plan" : "Generate the initial trip plan")}
            disabled={running || !data.orchestrator.enabled}
            className="rounded-full border border-[var(--accent-line)] px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--accent-line)] hover:bg-[var(--accent-line)] hover:text-[var(--surface-base)] disabled:opacity-50"
            title={plan ? "Ask the orchestrator to refresh the plan" : "Ask the orchestrator to draft the plan"}
          >
            {running ? "Running…" : plan ? "Refresh plan" : "Generate plan"}
          </button>
        </div>

        {!plan ? (
          <div className="rounded-[var(--radius-lg)] border border-dashed border-[var(--border-hairline)] bg-[var(--surface-base)] p-8 text-center text-sm text-[var(--text-muted)]">
            The orchestrator hasn&apos;t built a plan for this trip yet.
            <br />
            Click <span className="font-medium text-[var(--text-primary)]">Generate plan</span> to draft one from the trip context.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {plan.categories.map((c) => (
              <article
                key={c.id}
                className="flex min-h-[180px] flex-col gap-2 rounded-[var(--radius-lg)] border border-[var(--border-hairline)] bg-[var(--surface-raised)] p-4"
              >
                <header>
                  <h3 className="text-sm font-semibold text-[var(--text-primary)]">{c.title}</h3>
                  {c.summary && (
                    <p className="mt-0.5 text-[11px] leading-snug text-[var(--text-muted)]">
                      {c.summary}
                    </p>
                  )}
                </header>
                <ul className="flex-1 space-y-2">
                  {c.tasks.map((t) => (
                    <li key={t.id} className="flex items-start gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={t.done}
                        onChange={(e) => void toggleTask(c.id, t.id, e.currentTarget.checked)}
                        className="mt-0.5 h-3.5 w-3.5 shrink-0 cursor-pointer accent-[var(--accent-line)]"
                      />
                      <div className="min-w-0 flex-1">
                        <div
                          className={
                            t.done
                              ? "line-through text-[var(--text-muted)]"
                              : "text-[var(--text-primary)]"
                          }
                        >
                          {t.title}
                        </div>
                        {t.note && (
                          <div className="mt-0.5 text-[10px] text-[var(--text-muted)]">{t.note}</div>
                        )}
                        {t.outcome && (
                          <div className="mt-1 rounded-md border border-[var(--border-hairline)] bg-[var(--surface-base)] px-2 py-1">
                            <div className="text-[10px] leading-snug text-[var(--text-secondary)]">
                              <span className="text-[var(--accent-line)]">✦</span> {t.outcome.summary}
                            </div>
                            {t.outcome.links.length > 0 && (
                              <div className="mt-1 flex flex-wrap gap-1">
                                {t.outcome.links.map((link, i) => (
                                  <TaskLinkChip key={`${link.kind}:${link.id}:${i}`} tripId={tripId} link={link} />
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        )}
      </section>

      {/* Status footer */}
      <footer className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-md)] border border-[var(--border-hairline)] bg-[var(--surface-base)] px-3 py-2 text-[11px] text-[var(--text-muted)]">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={
              data.orchestrator.enabled
                ? "rounded-full bg-[var(--status-settled-soft)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--status-settled)]"
                : "rounded-full bg-[var(--surface-sunken)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]"
            }
          >
            {data.orchestrator.enabled ? "Active" : "Paused"}
          </span>
          <span className="truncate">
            {data.orchestrator.lastSummary ??
              (data.orchestrator.nextRunAt
                ? `next run ${formatRelative(data.orchestrator.nextRunAt)}`
                : "awaiting first run")}
          </span>
        </div>
        {pendingCount > 0 && (
          <span className="rounded-full bg-[var(--accent-line)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--surface-base)]">
            {pendingCount} pending
          </span>
        )}
      </footer>

      {error && (
        <div className="text-[10px] text-[var(--status-blocked)]">{error}</div>
      )}
    </div>
  );
}

/**
 * Chip rendered for each outcome link on a plan task. Internal kinds deep-link
 * to the matching bento grid / route; `external` opens the URL in a new tab
 * (booking pages, Google Maps, official sites).
 */
function TaskLinkChip({ tripId, link }: { tripId: string; link: PlanTaskLink }) {
  const target = chipTarget(tripId, link);
  if (!target) return null;
  const external = link.kind === "external";
  const className =
    "inline-flex items-center gap-1 rounded-full border border-[var(--border-hairline)] bg-[var(--surface-raised)] px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-[var(--text-muted)] hover:border-[var(--accent-line)] hover:text-[var(--accent-line)]";
  const inner = (
    <>
      <span>{target.label}</span>
      {link.label && (
        <span className="max-w-[160px] truncate normal-case tracking-normal text-[var(--text-secondary)]">
          {link.label}
        </span>
      )}
      {external && (
        <span aria-hidden className="text-[var(--text-muted)]">
          ↗
        </span>
      )}
    </>
  );
  if (external) {
    return (
      <a
        href={target.href}
        target="_blank"
        rel="noopener noreferrer"
        className={className}
        title={link.label ?? target.href}
      >
        {inner}
      </a>
    );
  }
  return (
    <Link href={target.href} className={className} title={link.label ?? target.label}>
      {inner}
    </Link>
  );
}

function chipTarget(
  tripId: string,
  link: PlanTaskLink,
): { label: string; href: string } | null {
  switch (link.kind) {
    case "item":
      return { label: "Item", href: `/app/trips/${tripId}/board` };
    case "idea":
      return { label: "Idea", href: `/app/trips/${tripId}/ideas` };
    case "packItem":
      return { label: "Pack", href: `/app/trips/${tripId}/pack` };
    case "expense":
      return { label: "Expense", href: `/app/trips/${tripId}/expenses` };
    case "customGrid":
      return link.id
        ? { label: "Grid", href: `/app/trips/${tripId}?mode=bento&scroll=custom:${link.id}` }
        : null;
    case "trip":
      return { label: "Trip", href: `/app/trips/${tripId}?mode=bento` };
    case "external":
      if (!link.url) return null;
      return { label: labelForExternal(link.url), href: link.url };
  }
}

function labelForExternal(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (host === "maps.google.com" || (host === "google.com" && u.pathname.startsWith("/maps"))) {
      return "Maps";
    }
    if (host.endsWith("google.com")) return "Google";
    return host.split(".")[0]?.slice(0, 14) ?? "Link";
  } catch {
    return "Link";
  }
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

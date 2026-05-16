"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";

/**
 * Provenance for an AI-written row. Surfaced as a small badge and an
 * "explain" side sheet — the workspace's audit trail for agent actions.
 */
export interface ProvenanceInfo {
  /** Registry key of the agent ("flight_price_tracker", "group_chat_parser", ...). */
  agent: string;
  /** Human-readable agent name; falls back to `agent`. */
  agentLabel?: string;
  /** When the agent wrote this. */
  createdAt: string;
  /** Optional: where the agent's signal originated (chat snippet, search query, etc.). */
  inputs?: Record<string, unknown> | null;
  /** Optional: a stable id for the run that produced this row (custom_grid_run / agent_run). */
  runId?: string | null;
}

export function ProvenanceBadge({
  provenance,
  onClick,
  className,
}: {
  provenance: ProvenanceInfo;
  onClick?: () => void;
  className?: string;
}) {
  const relative = formatRelative(provenance.createdAt);
  const label = provenance.agentLabel ?? humanizeAgent(provenance.agent);
  const Comp = onClick ? "button" : "span";

  return (
    <Comp
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-[var(--accent-line)]/40 bg-[var(--accent-line-soft)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[var(--accent-line)]",
        onClick && "hover:bg-[var(--accent-line)]/15",
        className,
      )}
      title={onClick ? "Why was this proposed?" : undefined}
    >
      <span aria-hidden>✦</span>
      <span>
        {label} · {relative}
      </span>
      {onClick && <span className="ml-0.5 opacity-60">?</span>}
    </Comp>
  );
}

export function ProvenanceSheet({
  open,
  onOpenChange,
  provenance,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provenance: ProvenanceInfo;
}) {
  const label = provenance.agentLabel ?? humanizeAgent(provenance.agent);
  const inputs = provenance.inputs ?? null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Why this was proposed</SheetTitle>
          <SheetDescription>
            This row was created by an AI agent. Nothing here is auto-applied —
            you confirm, edit, or dismiss.
          </SheetDescription>
        </SheetHeader>

        <dl className="mt-6 grid gap-3 text-sm">
          <div className="grid grid-cols-[100px_1fr] gap-2">
            <dt className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">Agent</dt>
            <dd className="text-[var(--text-primary)]">{label}</dd>
          </div>
          <div className="grid grid-cols-[100px_1fr] gap-2">
            <dt className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">When</dt>
            <dd className="text-[var(--text-primary)]">
              {new Date(provenance.createdAt).toLocaleString()}
            </dd>
          </div>
          {provenance.runId && (
            <div className="grid grid-cols-[100px_1fr] gap-2">
              <dt className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">Run</dt>
              <dd className="font-mono text-xs text-[var(--text-secondary)]">
                {provenance.runId}
              </dd>
            </div>
          )}
        </dl>

        {inputs && Object.keys(inputs).length > 0 && (
          <div className="mt-6">
            <div className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
              Inputs
            </div>
            <pre className="mt-2 max-h-72 overflow-auto rounded-md border border-[var(--border-hairline)] bg-[var(--surface-sunken)] p-3 text-[11px] leading-relaxed text-[var(--text-secondary)]">
              {JSON.stringify(inputs, null, 2)}
            </pre>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

/**
 * Convenience hook: render the badge inline with click-to-open behavior.
 * Use this when you need provenance on a non-ghost row (e.g. a confirmed
 * item that originated from AI extraction).
 */
export function ProvenanceTag({ provenance }: { provenance: ProvenanceInfo }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <ProvenanceBadge provenance={provenance} onClick={() => setOpen(true)} />
      <ProvenanceSheet open={open} onOpenChange={setOpen} provenance={provenance} />
    </>
  );
}

function humanizeAgent(agent: string): string {
  return agent
    .split("_")
    .map((part) => (part.length ? part[0]!.toUpperCase() + part.slice(1) : part))
    .join(" ");
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

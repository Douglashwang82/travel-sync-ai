"use client";

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { IconCheck, IconClose } from "@/components/app/icons";
import {
  ProvenanceBadge,
  ProvenanceSheet,
  type ProvenanceInfo,
} from "@/components/app/grids/provenance";

/**
 * A ghost item is something an AI agent has proposed but a human has not yet
 * accepted. Tiles render a `<GhostLane>` above their committed content and
 * fill it with `<GhostCard>`s. Confirming pulls the row into the tile's
 * normal lane; dismissing soft-removes it.
 *
 * This is the canonical "AI proposes, human decides" surface — the same
 * pattern as the original AIGhostCard in `trip-ai-updates.tsx`, lifted so
 * every tile can reuse it.
 */
export function GhostLane({
  label,
  hint,
  children,
  className,
}: {
  label?: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  const count = Array.isArray(children) ? children.filter(Boolean).length : children ? 1 : 0;
  if (count === 0) return null;

  return (
    <section
      className={cn(
        "mb-3 rounded-lg border border-dashed border-[var(--ai-authored)]/30 bg-[var(--ai-authored-soft)] px-3 py-2",
        className,
      )}
    >
      <header className="mb-2 flex items-center justify-between gap-2 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
        <span className="font-semibold">{label ?? "AI 建議"}</span>
        {hint && <span className="truncate">{hint}</span>}
      </header>
      <ul className="space-y-2">{children}</ul>
    </section>
  );
}

export function GhostCard({
  title,
  description,
  kindLabel,
  provenance,
  onConfirm,
  onEdit,
  onDismiss,
  copy = DEFAULT_COPY,
}: {
  title: string;
  description?: string | null;
  /** Short type chip ("Hotel", "Activity", etc.). */
  kindLabel?: string;
  provenance: ProvenanceInfo;
  onConfirm?: () => void;
  onEdit?: () => void;
  onDismiss: () => void;
  copy?: GhostCopy;
}) {
  const [removing, setRemoving] = useState(false);
  const [whyOpen, setWhyOpen] = useState(false);

  return (
    <>
      <li
        className={cn(
          "ghost-card relative px-3.5 py-3 transition-opacity",
          removing && "pointer-events-none opacity-0",
        )}
        style={{ transitionDuration: "var(--duration-morph)" }}
      >
        <div className="flex flex-wrap items-center gap-2">
          {kindLabel && (
            <span className="rounded-full bg-[var(--surface-raised)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
              {kindLabel}
            </span>
          )}
          <ProvenanceBadge
            provenance={provenance}
            onClick={() => setWhyOpen(true)}
          />
        </div>

        {onEdit ? (
          <button
            type="button"
            onClick={onEdit}
            className="mt-1.5 block w-full text-left text-sm font-medium text-[var(--text-primary)] hover:underline"
          >
            {title}
          </button>
        ) : (
          <div className="mt-1.5 text-sm font-medium text-[var(--text-primary)]">{title}</div>
        )}

        {description && (
          <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-[var(--text-muted)]">
            {description}
          </p>
        )}

        <div className="mt-2.5 flex items-center gap-1.5">
          {onConfirm && (
            <button
              type="button"
              onClick={onConfirm}
              className="inline-flex items-center gap-1 rounded-full bg-[var(--accent-line)] px-2.5 py-1 text-[11px] font-semibold text-[var(--primary-foreground)] hover:opacity-95"
            >
              <IconCheck size={12} />
              {copy.confirm}
            </button>
          )}
          {onEdit && (
            <button
              type="button"
              onClick={onEdit}
              className="rounded-full border border-[var(--border-hairline)] px-2.5 py-1 text-[11px] font-medium text-[var(--text-secondary)] hover:border-[var(--border-strong)]"
            >
              {copy.edit}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setRemoving(true);
              setTimeout(onDismiss, 320);
            }}
            className="ml-auto inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            <IconClose size={12} />
            {copy.dismiss}
          </button>
        </div>
      </li>

      <ProvenanceSheet open={whyOpen} onOpenChange={setWhyOpen} provenance={provenance} />
    </>
  );
}

interface GhostCopy {
  confirm: string;
  edit: string;
  dismiss: string;
}

const DEFAULT_COPY: GhostCopy = {
  confirm: "確認",
  edit: "編輯",
  dismiss: "忽略",
};

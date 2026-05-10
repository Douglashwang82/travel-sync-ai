"use client";

import { useState } from "react";
import { useAppLocale } from "@/components/app/app-locale-provider";
import { cn } from "@/lib/utils";
import type { BoardData, TripItem } from "@/lib/types";
import { ITEM_TYPE_LABELS } from "@/components/app/board-columns";
import { IconCheck, IconClose } from "@/components/app/icons";

const COPY = {
  en: { title: "AI updates", sub: "Pulled from your LINE chat. Confirm, edit, or dismiss - never auto-applied.", empty: "Nothing extracted yet. Mention dates, hotels, or restaurants in chat and they'll show up here.", confirm: "Confirm", edit: "Edit", dismiss: "Dismiss", from: "from", at: "at", fallbackItem: "Item" },
  "zh-TW": { title: "AI 摘要", sub: "由 LINE 群組訊息整理，請先審核，系統不會自動寫入。", empty: "目前還沒有 AI 整理的項目。在群組裡聊到日期、飯店或餐廳，這裡就會出現。", confirm: "確認", edit: "編輯", dismiss: "略過", from: "來自", at: "於", fallbackItem: "項目" },
} as const;

interface AIUpdatesTileProps {
  board: BoardData;
  onItemClick: (item: TripItem) => void;
  onConfirm?: (item: TripItem) => void;
  onDismiss?: (item: TripItem) => void;
}

export function AIUpdatesTile({
  board,
  onItemClick,
  onConfirm,
  onDismiss,
}: AIUpdatesTileProps) {
  const { locale } = useAppLocale();
  const copy = COPY[locale];

  const all: TripItem[] = [...board.todo, ...board.pending, ...board.confirmed];
  const aiItems = all
    .filter((i) => i.source === "ai")
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 6);

  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const visible = aiItems.filter((i) => !dismissed.has(i.id));

  function dismiss(item: TripItem) {
    setDismissed((prev) => new Set(prev).add(item.id));
    onDismiss?.(item);
  }

  return (
    <section className="surface-tile flex h-full flex-col p-6">
      <header>
        <h2 className="text-display text-2xl text-[var(--text-primary)]">{copy.title}</h2>
        <p className="mt-1 text-xs text-[var(--text-muted)]">{copy.sub}</p>
      </header>

      {visible.length === 0 ? (
        <div className="mt-6 flex flex-1 items-center justify-center rounded-xl border border-dashed border-[var(--border-hairline)] bg-[var(--surface-sunken)]/40 px-4 py-10 text-center">
          <p className="text-sm text-[var(--text-muted)]">{copy.empty}</p>
        </div>
      ) : (
        <ul className="mt-5 flex-1 space-y-2.5 overflow-y-auto pr-1">
          {visible.map((item) => {
            const time = new Date(item.created_at);
            return (
              <AIGhostCard
                key={item.id}
                title={item.title}
                description={item.description ?? null}
                provenance={`${copy.at} ${time.toLocaleString(locale === "zh-TW" ? "zh-TW" : undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`}
                kind={ITEM_TYPE_LABELS[item.item_type] ?? copy.fallbackItem}
                onConfirm={onConfirm ? () => onConfirm(item) : undefined}
                onEdit={() => onItemClick(item)}
                onDismiss={() => dismiss(item)}
                copy={copy}
              />
            );
          })}
        </ul>
      )}
    </section>
  );
}

function AIGhostCard({
  title,
  description,
  provenance,
  kind,
  onConfirm,
  onEdit,
  onDismiss,
  copy,
}: {
  title: string;
  description: string | null;
  provenance: string;
  kind: string;
  onConfirm?: () => void;
  onEdit: () => void;
  onDismiss: () => void;
  copy: typeof COPY[keyof typeof COPY];
}) {
  const [removing, setRemoving] = useState(false);
  return (
    <li
      className={cn(
        "ghost-card relative px-3.5 py-3 transition-opacity",
        removing && "pointer-events-none opacity-0",
      )}
      style={{ transitionDuration: "var(--duration-morph)" }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-[var(--surface-raised)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
          {kind}
        </span>
        <span className="text-[10px] text-[var(--text-muted)]">{provenance}</span>
      </div>
      <button
        type="button"
        onClick={onEdit}
        className="mt-1.5 block w-full text-left text-sm font-medium text-[var(--text-primary)] hover:underline"
      >
        {title}
      </button>
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
        <button
          type="button"
          onClick={onEdit}
          className="rounded-full border border-[var(--border-hairline)] px-2.5 py-1 text-[11px] font-medium text-[var(--text-secondary)] hover:border-[var(--border-strong)]"
        >
          {copy.edit}
        </button>
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
  );
}

// Backwards-compat alias.
export const TripAIUpdates = AIUpdatesTile;

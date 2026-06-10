"use client";

import { useState } from "react";
import { useAppLocale } from "@/components/app/app-locale-provider";
import type { BoardData, TripItem } from "@/lib/types";
import { ITEM_TYPE_LABELS } from "@/components/app/board-columns";
import { GhostCard } from "@/components/app/grids/ghost-lane";
import type { ProvenanceInfo } from "@/components/app/grids/provenance";

const COPY = {
  en: {
    title: "AI updates",
    sub: "Pulled from your LINE chat. Confirm, edit, or dismiss — never auto-applied.",
    empty: "Nothing extracted yet. Mention dates, hotels, or restaurants in chat and they'll show up here.",
    confirm: "Confirm",
    edit: "Edit",
    dismiss: "Dismiss",
    fallbackItem: "Item",
    showAll: (n: number) => `Review all ${n} suggestions`,
    showLess: "Show fewer",
  },
  "zh-TW": {
    title: "AI 摘要",
    sub: "由 LINE 群組訊息整理，請先審核，系統不會自動寫入。",
    empty: "目前還沒有 AI 整理的項目。在群組裡聊到日期、飯店或餐廳，這裡就會出現。",
    confirm: "確認",
    edit: "編輯",
    dismiss: "略過",
    fallbackItem: "項目",
    showAll: (n: number) => `查看全部 ${n} 則建議`,
    showLess: "收合",
  },
} as const;

/** Max proposals shown without explicit expansion (decision-friction budget). */
const VISIBLE_CAP = 3;

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
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState(false);
  const pending = aiItems.filter((i) => !dismissed.has(i.id));
  const visible = expanded ? pending : pending.slice(0, VISIBLE_CAP);
  const hiddenCount = pending.length - visible.length;

  function dismiss(item: TripItem) {
    setDismissed((prev) => new Set(prev).add(item.id));
    onDismiss?.(item);
  }

  return (
    <section id="tile-ai-updates" className="surface-tile flex h-full flex-col p-6">
      <header>
        <h2 className="text-display text-2xl text-[var(--text-primary)]">{copy.title}</h2>
        <p className="mt-1 text-xs text-[var(--text-muted)]">{copy.sub}</p>
      </header>

      {visible.length === 0 ? (
        <div className="mt-6 flex flex-1 items-center justify-center rounded-xl border border-dashed border-[var(--border-hairline)] bg-[var(--surface-sunken)]/40 px-4 py-10 text-center">
          <p className="text-sm text-[var(--text-muted)]">{copy.empty}</p>
        </div>
      ) : (
        <>
          <ul
            id="tile-ai-updates-list"
            role="feed"
            aria-live="polite"
            className="mt-5 flex-1 space-y-2.5 overflow-y-auto pr-1"
          >
            {visible.map((item) => (
              <GhostCard
                key={item.id}
                title={item.title}
                description={item.description ?? null}
                kindLabel={ITEM_TYPE_LABELS[item.item_type] ?? copy.fallbackItem}
                provenance={toProvenance(item)}
                onConfirm={onConfirm ? () => onConfirm(item) : undefined}
                onEdit={() => onItemClick(item)}
                onDismiss={() => dismiss(item)}
                copy={{ confirm: copy.confirm, edit: copy.edit, dismiss: copy.dismiss }}
              />
            ))}
          </ul>
          {(hiddenCount > 0 || expanded) && (
            <button
              id="tile-ai-updates-toggle"
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-2 self-start rounded-full border border-[var(--ai-authored)]/40 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--ai-authored)] hover:bg-[var(--ai-authored-soft)]"
            >
              {expanded ? copy.showLess : copy.showAll(pending.length)}
            </button>
          )}
        </>
      )}
    </section>
  );
}

function toProvenance(item: TripItem): ProvenanceInfo {
  return {
    agent: item.source_agent ?? "group_chat_parser",
    createdAt: item.created_at,
    inputs: item.source_inputs,
    runId: item.source_run_id,
  };
}

// Backwards-compat alias.
export const TripAIUpdates = AIUpdatesTile;

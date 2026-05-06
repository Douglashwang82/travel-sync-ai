"use client";

import { Badge } from "@/components/ui/badge";
import type { BoardData, TripItem } from "@/lib/types";
import { ITEM_TYPE_LABELS } from "@/components/app/board-columns";

const SOURCE_LABEL: Record<string, string> = {
  ai: "AI extracted",
  command: "Slash command",
  manual: "Added manually",
  system: "System",
};

const SOURCE_TONE: Record<string, string> = {
  ai: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
  command: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  manual:
    "bg-[var(--secondary)] text-[var(--muted-foreground)]",
  system:
    "bg-[var(--secondary)] text-[var(--muted-foreground)]",
};

export function TripAIUpdates({
  board,
  onItemClick,
}: {
  board: BoardData;
  onItemClick: (item: TripItem) => void;
}) {
  const all: TripItem[] = [
    ...board.todo,
    ...board.pending,
    ...board.confirmed,
  ];
  const aiItems = all
    .filter((i) => i.source === "ai")
    .sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )
    .slice(0, 6);

  return (
    <section className="rounded-3xl border border-[var(--border)] bg-[var(--background)] p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">AI updates</h2>
          <p className="text-[11px] text-[var(--muted-foreground)]">
            Items extracted from your LINE chat. Approve, edit, or dismiss.
          </p>
        </div>
        <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
          ✨ AI
        </span>
      </div>

      {aiItems.length === 0 ? (
        <div className="mt-4 rounded-2xl border border-dashed border-[var(--border)] px-4 py-6 text-center text-xs text-[var(--muted-foreground)]">
          No AI-extracted items yet. Mention dates, hotels, or restaurants in
          your LINE group and they&apos;ll appear here.
        </div>
      ) : (
        <ul className="mt-4 divide-y divide-[var(--border)]">
          {aiItems.map((item) => (
            <li key={item.id} className="py-3 first:pt-0 last:pb-0">
              <button
                type="button"
                onClick={() => onItemClick(item)}
                className="block w-full rounded-lg text-left transition-colors hover:bg-[var(--secondary)]/40"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-medium">{item.title}</p>
                  <span
                    className={
                      "shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold " +
                      (SOURCE_TONE[item.source] ?? SOURCE_TONE.manual)
                    }
                  >
                    {SOURCE_LABEL[item.source] ?? "—"}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-[var(--muted-foreground)]">
                  <Badge variant="secondary" className="text-[9px] uppercase">
                    {ITEM_TYPE_LABELS[item.item_type] ?? "Item"}
                  </Badge>
                  <span>
                    {new Date(item.created_at).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                  <span className="capitalize">
                    →{" "}
                    {item.stage === "pending" ? "pending vote" : item.stage}
                  </span>
                </div>
                {item.description && (
                  <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-[var(--muted-foreground)]">
                    {item.description}
                  </p>
                )}
                <p className="mt-1.5 text-[10px] font-medium text-[var(--primary)]">
                  Tap to review →
                </p>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

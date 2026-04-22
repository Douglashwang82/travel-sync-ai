"use client";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import type { BoardData, ItemType, TripItem } from "@/lib/types";
import type { AppMember } from "@/app/api/app/trips/[tripId]/members/route";

export const ITEM_TYPE_LABELS: Record<ItemType, string> = {
  hotel: "Hotel",
  restaurant: "Restaurant",
  activity: "Activity",
  transport: "Transport",
  flight: "Flight",
  insurance: "Insurance",
  other: "Other",
};

export function BoardColumns({
  board,
  members,
  onItemClick,
}: {
  board: BoardData;
  members: AppMember[];
  onItemClick: (item: TripItem) => void;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Column
        title="To-Do"
        accent="text-[var(--muted-foreground)]"
        pillClass="bg-[var(--secondary)] text-[var(--muted-foreground)]"
        items={board.todo}
        members={members}
        onItemClick={onItemClick}
        empty="Nothing yet. Add a to-do or type /add in chat."
      />
      <Column
        title="Pending vote"
        accent="text-amber-600 dark:text-amber-400"
        pillClass="bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
        items={board.pending}
        members={members}
        onItemClick={onItemClick}
        empty="No active votes. Start one in chat with /vote."
      />
      <Column
        title="Confirmed"
        accent="text-[var(--primary)]"
        pillClass="bg-[#dcfce7] text-[#166534] dark:bg-[#14532d] dark:text-[#86efac]"
        items={board.confirmed}
        members={members}
        onItemClick={onItemClick}
        empty="Nothing confirmed yet."
      />
    </div>
  );
}

function Column({
  title,
  accent,
  pillClass,
  items,
  members,
  onItemClick,
  empty,
}: {
  title: string;
  accent: string;
  pillClass: string;
  items: TripItem[];
  members: AppMember[];
  onItemClick: (item: TripItem) => void;
  empty: string;
}) {
  return (
    <div className="flex flex-col rounded-2xl border border-[var(--border)] bg-[var(--background)]">
      <header className="flex items-center justify-between border-b border-[var(--border)] px-4 py-2.5">
        <span className={cn("text-sm font-semibold", accent)}>{title}</span>
        <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", pillClass)}>
          {items.length}
        </span>
      </header>
      <div className="flex-1 divide-y divide-[var(--border)]">
        {items.length === 0 ? (
          <p className="px-4 py-4 text-xs italic text-[var(--muted-foreground)]">{empty}</p>
        ) : (
          items.map((item) => (
            <ItemRow key={item.id} item={item} members={members} onClick={() => onItemClick(item)} />
          ))
        )}
      </div>
    </div>
  );
}

function ItemRow({
  item,
  members,
  onClick,
}: {
  item: TripItem;
  members: AppMember[];
  onClick: () => void;
}) {
  const assignee = item.assigned_to_line_user_id
    ? (members.find((m) => m.lineUserId === item.assigned_to_line_user_id)?.displayName ??
      item.assigned_to_line_user_id)
    : null;

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full flex-col gap-1.5 px-4 py-3 text-left transition-colors hover:bg-[var(--secondary)]/60"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="flex-1 text-sm font-medium">{item.title}</span>
        <Badge variant="secondary" className="text-[10px] uppercase">
          {ITEM_TYPE_LABELS[item.item_type]}
        </Badge>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--muted-foreground)]">
        {assignee && (
          <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
            {assignee}
          </span>
        )}
        {item.stage === "confirmed" && item.booking_status === "needed" && (
          <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
            Book
          </span>
        )}
        {item.stage === "confirmed" && item.booking_status === "booked" && (
          <span className="rounded-full bg-[#dcfce7] px-1.5 py-0.5 text-[#166534] dark:bg-[#14532d] dark:text-[#86efac]">
            ✓ Booked
          </span>
        )}
        {item.deadline_at && (
          <span className="rounded-full bg-[var(--secondary)] px-1.5 py-0.5">
            {new Date(item.deadline_at).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
            })}
          </span>
        )}
      </div>
    </button>
  );
}

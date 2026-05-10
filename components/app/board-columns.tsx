"use client";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import type { BoardData, ItemType, TripItem } from "@/lib/types";
import type { AppMember } from "@/app/api/app/trips/[tripId]/members/route";

export const ITEM_TYPE_LABELS: Record<ItemType, string> = {
  hotel: "住宿",
  restaurant: "餐廳",
  activity: "活動",
  transport: "交通",
  flight: "航班",
  insurance: "保險",
  other: "其他",
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
        title="待辦"
        accent="text-[var(--text-muted)]"
        pillClass="bg-[var(--surface-sunken)] text-[var(--text-muted)]"
        items={board.todo}
        members={members}
        onItemClick={onItemClick}
        empty="目前還沒有事項。新增一個待辦，或在聊天中輸入 /add。"
      />
      <Column
        title="投票中"
        accent="text-[var(--status-needs-decision)]"
        pillClass="bg-[var(--status-needs-decision-soft)] text-[var(--status-needs-decision)]"
        items={board.pending}
        members={members}
        onItemClick={onItemClick}
        empty="目前沒有進行中的投票。可在聊天中用 /vote 開始。"
      />
      <Column
        title="已確認"
        accent="text-[var(--accent-line)]"
        pillClass="bg-[var(--status-settled-soft)] text-[var(--status-settled)]"
        items={board.confirmed}
        members={members}
        onItemClick={onItemClick}
        empty="目前還沒有已確認事項。"
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
    <div className="surface-tile flex flex-col">
      <header className="flex items-center justify-between border-b border-[var(--border-hairline)] px-4 py-2.5">
        <span className={cn("text-caps", accent)}>{title}</span>
        <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", pillClass)}>
          {items.length}
        </span>
      </header>
      <div className="flex-1 divide-y divide-[var(--border-hairline)]">
        {items.length === 0 ? (
          <p className="px-4 py-4 text-xs italic text-[var(--text-muted)]">{empty}</p>
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
      className="flex w-full flex-col gap-1.5 px-4 py-3 text-left transition-colors hover:bg-[var(--surface-sunken)]"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="flex-1 text-sm font-medium text-[var(--text-primary)]">
          {item.title}
        </span>
        <Badge variant="secondary" className="text-[10px] uppercase">
          {ITEM_TYPE_LABELS[item.item_type]}
        </Badge>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--text-muted)]">
        {assignee && (
          <span className="rounded-full bg-[var(--accent-line-soft)] px-1.5 py-0.5 text-[var(--accent-line)]">
            {assignee}
          </span>
        )}
        {item.stage === "confirmed" && item.booking_status === "needed" && (
          <span className="rounded-full bg-[var(--status-needs-decision-soft)] px-1.5 py-0.5 text-[var(--status-needs-decision)]">
            待預訂
          </span>
        )}
        {item.stage === "confirmed" && item.booking_status === "booked" && (
          <span className="rounded-full bg-[var(--status-settled-soft)] px-1.5 py-0.5 text-[var(--status-settled)]">
            已預訂
          </span>
        )}
        {item.deadline_at && (
          <span className="text-mono rounded-full bg-[var(--surface-sunken)] px-1.5 py-0.5">
            {new Date(item.deadline_at).toLocaleDateString("zh-TW", {
              month: "short",
              day: "numeric",
            })}
          </span>
        )}
      </div>
    </button>
  );
}

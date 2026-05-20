"use client";

import { useRef, useState, type DragEvent } from "react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { TileImage } from "@/components/app/grids/tile-image";
import type { BoardData, ItemStage, ItemType, TripItem } from "@/lib/types";
import type { AppMember } from "@/app/api/app/trips/[tripId]/members/route";

const TRIP_ITEM_DRAG_TYPE = "application/x-trip-item";

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
  canMoveItems = false,
  movingItemId = null,
  onItemStageChange,
}: {
  board: BoardData;
  members: AppMember[];
  onItemClick: (item: TripItem) => void;
  canMoveItems?: boolean;
  movingItemId?: string | null;
  onItemStageChange?: (item: TripItem, stage: ItemStage) => void;
}) {
  const allItems = [...board.todo, ...board.pending, ...board.confirmed];
  const covers = board.covers ?? {};

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Column
        stage="todo"
        title="待辦"
        accent="text-[var(--text-muted)]"
        pillClass="bg-[var(--surface-sunken)] text-[var(--text-muted)]"
        items={board.todo}
        allItems={allItems}
        members={members}
        covers={covers}
        onItemClick={onItemClick}
        canMoveItems={canMoveItems}
        movingItemId={movingItemId}
        onItemStageChange={onItemStageChange}
        empty="目前還沒有事項。新增一個待辦，或在聊天中輸入 /add。"
      />
      <Column
        stage="pending"
        title="進行中"
        accent="text-[var(--status-needs-decision)]"
        pillClass="bg-[var(--status-needs-decision-soft)] text-[var(--status-needs-decision)]"
        items={board.pending}
        allItems={allItems}
        members={members}
        covers={covers}
        onItemClick={onItemClick}
        canMoveItems={canMoveItems}
        movingItemId={movingItemId}
        onItemStageChange={onItemStageChange}
        empty="目前沒有進行中的事項。"
      />
      <Column
        stage="confirmed"
        title="已確認"
        accent="text-[var(--accent-line)]"
        pillClass="bg-[var(--status-settled-soft)] text-[var(--status-settled)]"
        items={board.confirmed}
        allItems={allItems}
        members={members}
        covers={covers}
        onItemClick={onItemClick}
        canMoveItems={canMoveItems}
        movingItemId={movingItemId}
        onItemStageChange={onItemStageChange}
        empty="目前還沒有已確認事項。"
      />
    </div>
  );
}

function Column({
  stage,
  title,
  accent,
  pillClass,
  items,
  allItems,
  members,
  covers,
  onItemClick,
  canMoveItems,
  movingItemId,
  onItemStageChange,
  empty,
}: {
  stage: ItemStage;
  title: string;
  accent: string;
  pillClass: string;
  items: TripItem[];
  allItems: TripItem[];
  members: AppMember[];
  covers: NonNullable<BoardData["covers"]>;
  onItemClick: (item: TripItem) => void;
  canMoveItems: boolean;
  movingItemId: string | null;
  onItemStageChange?: (item: TripItem, stage: ItemStage) => void;
  empty: string;
}) {
  const [dragOver, setDragOver] = useState(false);

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    if (!canMoveItems || !e.dataTransfer.types.includes(TRIP_ITEM_DRAG_TYPE)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOver(true);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    if (!canMoveItems || !onItemStageChange) return;
    const itemId = e.dataTransfer.getData(TRIP_ITEM_DRAG_TYPE);
    const item = allItems.find((candidate) => candidate.id === itemId);
    setDragOver(false);
    if (!item || item.stage === stage) return;
    onItemStageChange(item, stage);
  }

  return (
    <div
      className={cn(
        "surface-tile flex flex-col transition-[box-shadow,outline-color]",
        dragOver && "outline outline-2 outline-[var(--accent-line)]"
      )}
      onDragOver={handleDragOver}
      onDragEnter={handleDragOver}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
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
            <ItemRow
              key={item.id}
              item={item}
              members={members}
              cover={covers[item.id]}
              canMove={canMoveItems}
              moving={movingItemId === item.id}
              onClick={() => onItemClick(item)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function ItemRow({
  item,
  members,
  cover,
  canMove,
  moving,
  onClick,
}: {
  item: TripItem;
  members: AppMember[];
  cover: { imageUrl: string | null; photoName: string | null } | undefined;
  canMove: boolean;
  moving: boolean;
  onClick: () => void;
}) {
  const draggedRef = useRef(false);
  const assignee = item.assigned_to_line_user_id
    ? (members.find((m) => m.lineUserId === item.assigned_to_line_user_id)?.displayName ??
      item.assigned_to_line_user_id)
    : null;

  return (
    <button
      type="button"
      draggable={canMove}
      onDragStart={(e) => {
        if (!canMove) return;
        draggedRef.current = true;
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData(TRIP_ITEM_DRAG_TYPE, item.id);
      }}
      onDragEnd={() => {
        window.setTimeout(() => {
          draggedRef.current = false;
        }, 0);
      }}
      onClick={(e) => {
        if (draggedRef.current) {
          e.preventDefault();
          return;
        }
        onClick();
      }}
      className={cn(
        "flex w-full cursor-pointer items-start gap-3 px-4 py-3 text-left transition-[background-color,opacity] hover:bg-[var(--surface-sunken)]",
        canMove && "active:cursor-grabbing",
        moving && "opacity-50"
      )}
      aria-disabled={moving}
    >
      <TileImage
        src={cover?.imageUrl ?? undefined}
        photoName={cover?.photoName ?? undefined}
        itemType={item.item_type}
        alt={item.title}
        shape="thumb"
        size={{ w: 200, h: 200 }}
        className="!h-12 !w-12"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-start justify-between gap-2">
          <span className="flex-1 text-sm font-medium text-[var(--text-primary)]">
            {item.title}
          </span>
          <span className="flex shrink-0 flex-wrap justify-end gap-1">
            <Badge variant="secondary" className="text-[10px] uppercase">
              {ITEM_TYPE_LABELS[item.item_type]}
            </Badge>
            {item.item_kind === "decision" && (
              <Badge variant="secondary" className="text-[10px] uppercase">
                群組決策
              </Badge>
            )}
          </span>
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
      </div>
    </button>
  );
}

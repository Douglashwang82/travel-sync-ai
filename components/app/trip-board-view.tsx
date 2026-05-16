"use client";

import { useCallback, useEffect, useState } from "react";
import { appFetchJson, AppApiFetchError } from "@/lib/app-client";
import { Button } from "@/components/ui/button";
import type { BoardData, ItemStage, TripItem } from "@/lib/types";
import type { AppMember } from "@/app/api/app/trips/[tripId]/members/route";
import { BoardColumns } from "@/components/app/board-columns";
import { ItemDetailDialog } from "@/components/app/item-detail-dialog";
import { AddItemDialog } from "@/components/app/add-item-dialog";
import { TabPageHeader, TabError, TabSkeleton } from "@/components/app/tab-shell";

interface BoardViewData {
  board: BoardData;
  members: AppMember[];
  role: "organizer" | "member";
}

export function TripBoardView({ tripId }: { tripId: string }) {
  const [data, setData] = useState<BoardViewData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<TripItem | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [movingItemId, setMovingItemId] = useState<string | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    try {
      const [tripRes, board, members] = await Promise.all([
        appFetchJson<{ trip: unknown; role: "organizer" | "member" }>(
          `/api/app/trips/${tripId}`
        ),
        appFetchJson<BoardData>(`/api/app/trips/${tripId}/board`),
        appFetchJson<{ members: AppMember[] }>(
          `/api/app/trips/${tripId}/members`
        ),
      ]);
      setLoadError(null);
      setData({
        board,
        members: members.members,
        role: tripRes.role,
      });
    } catch (err) {
      setLoadError(
        err instanceof AppApiFetchError
          ? err.message
          : "旅程看板載入失敗"
      );
    }
  }, [tripId]);

  useEffect(() => {
    void (async () => {
      await loadAll();
    })();
  }, [loadAll]);

  if (loadError) {
    return <TabError message={loadError} onRetry={() => void loadAll()} />;
  }

  if (!data) {
    return (
      <div className="grid gap-4 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <TabSkeleton key={i} />
        ))}
      </div>
    );
  }

  const viewData: BoardViewData = data;
  const { board, members, role } = viewData;
  const isOrganizer = role === "organizer";
  const total = board.todo.length + board.pending.length + board.confirmed.length;

  async function handleItemStageChange(item: TripItem, stage: ItemStage) {
    if (!isOrganizer || item.stage === stage || movingItemId) return;

    const previous = viewData;
    const optimistic = { ...item, stage };
    setMoveError(null);
    setMovingItemId(item.id);
    setData({
      ...viewData,
      board: placeBoardItem(viewData.board, optimistic),
    });

    try {
      const updated = await appFetchJson<TripItem>(`/api/app/trips/${tripId}/items`, {
        method: "POST",
        body: JSON.stringify({
          action: "move_stage",
          itemId: item.id,
          stage,
        }),
      });
      setData((current) =>
        current
          ? {
              ...current,
              board: placeBoardItem(current.board, updated),
            }
          : current
      );
      setSelectedItem((current) => (current?.id === updated.id ? updated : current));
    } catch (err) {
      setData(previous);
      setMoveError(err instanceof Error ? err.message : "Failed to move item");
    } finally {
      setMovingItemId(null);
    }
  }

  return (
    <>
      <div className="space-y-4">
        <TabPageHeader
          id="board-page-header"
          title="進階看板"
          subtitle={`${total} 個項目分布在待辦、進行中與已確認。若想用地圖優先的方式瀏覽，請回到總覽。`}
          actions={
            isOrganizer ? (
              <Button size="sm" onClick={() => setAddOpen(true)}>
                + 新增項目
              </Button>
            ) : undefined
          }
        />

        <BoardColumns
          board={board}
          members={members}
          onItemClick={setSelectedItem}
          canMoveItems={isOrganizer}
          movingItemId={movingItemId}
          onItemStageChange={(item, stage) => void handleItemStageChange(item, stage)}
        />
        {moveError && <p className="text-xs text-destructive">{moveError}</p>}
      </div>

      <AddItemDialog
        tripId={tripId}
        open={addOpen}
        onOpenChange={setAddOpen}
        onCreated={() => {
          setAddOpen(false);
          void loadAll();
        }}
      />

      <ItemDetailDialog
        tripId={tripId}
        item={selectedItem}
        members={members}
        isOrganizer={isOrganizer}
        onOpenChange={(open) => {
          if (!open) setSelectedItem(null);
        }}
        onItemChanged={(updated) => {
          setSelectedItem(updated);
          void loadAll();
        }}
        onItemDeleted={() => {
          setSelectedItem(null);
          void loadAll();
        }}
      />
    </>
  );
}

function placeBoardItem(board: BoardData, item: TripItem): BoardData {
  const withoutItem = {
    todo: board.todo.filter((candidate) => candidate.id !== item.id),
    pending: board.pending.filter((candidate) => candidate.id !== item.id),
    confirmed: board.confirmed.filter((candidate) => candidate.id !== item.id),
  };

  return {
    ...board,
    todo: item.stage === "todo" ? [...withoutItem.todo, item] : withoutItem.todo,
    pending:
      item.stage === "pending" ? [...withoutItem.pending, item] : withoutItem.pending,
    confirmed:
      item.stage === "confirmed"
        ? [...withoutItem.confirmed, item]
        : withoutItem.confirmed,
  };
}

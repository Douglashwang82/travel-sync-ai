"use client";

import { useCallback, useEffect, useState } from "react";
import { appFetchJson, AppApiFetchError } from "@/lib/app-client";
import { Button } from "@/components/ui/button";
import type { BoardData, TripItem } from "@/lib/types";
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

  const { board, members, role } = data;
  const isOrganizer = role === "organizer";
  const total = board.todo.length + board.pending.length + board.confirmed.length;

  return (
    <>
      <div className="space-y-4">
        <TabPageHeader
          id="board-page-header"
          title="進階看板"
          subtitle={`${total} 個項目分布在待辦、投票中與已確認。若想用地圖優先的方式瀏覽，請回到總覽。`}
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
        />
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

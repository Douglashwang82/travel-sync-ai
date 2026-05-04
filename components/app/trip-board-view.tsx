"use client";

import { useCallback, useEffect, useState } from "react";
import { appFetchJson, AppApiFetchError } from "@/lib/app-client";
import { Button } from "@/components/ui/button";
import type { BoardData, TripItem } from "@/lib/types";
import type { AppMember } from "@/app/api/app/trips/[tripId]/members/route";
import { BoardColumns } from "@/components/app/board-columns";
import { ItemDetailDialog } from "@/components/app/item-detail-dialog";
import { AddItemDialog } from "@/components/app/add-item-dialog";

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
          : "Failed to load trip board"
      );
    }
  }, [tripId]);

  useEffect(() => {
    void (async () => {
      await loadAll();
    })();
  }, [loadAll]);

  if (loadError) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
        {loadError}{" "}
        <button
          type="button"
          onClick={() => void loadAll()}
          className="ml-2 underline underline-offset-2"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="grid animate-pulse gap-4 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-64 rounded-2xl border border-[var(--border)] bg-[var(--background)]"
          />
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
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Advanced board</h2>
            <p className="text-xs text-[var(--muted-foreground)]">
              {total} item{total === 1 ? "" : "s"} across To-Do, Pending vote
              and Confirmed. Use the Workspace tab for the map-first view.
            </p>
          </div>
          {isOrganizer && (
            <Button size="sm" onClick={() => setAddOpen(true)}>
              + Add item
            </Button>
          )}
        </div>

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

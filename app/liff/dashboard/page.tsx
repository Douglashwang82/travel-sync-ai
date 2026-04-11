"use client";

import { useCallback, useEffect, useState } from "react";
import {
  BoardSkeleton,
  LoadingSpinner,
  ErrorScreen,
  EmptyState,
  InlineError,
} from "@/components/liff/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { liffFetch } from "@/lib/liff-client";
import { toLiffErrorMessage } from "@/lib/liff-errors";
import { useLiffSession } from "@/lib/use-liff-session";
import type { BoardData, TripItem, ItemType } from "@/lib/types";

const ITEM_TYPE_LABELS: Record<ItemType, string> = {
  hotel: "Hotel",
  restaurant: "Restaurant",
  activity: "Activity",
  transport: "Transport",
  flight: "Flight",
  insurance: "Insurance",
  other: "Other",
};

const ITEM_TYPES: { value: ItemType; label: string }[] = [
  { value: "hotel", label: "Hotel" },
  { value: "restaurant", label: "Restaurant" },
  { value: "activity", label: "Activity" },
  { value: "transport", label: "Transport" },
  { value: "flight", label: "Flight" },
  { value: "insurance", label: "Insurance" },
  { value: "other", label: "Other" },
];

export default function DashboardPage() {
  const { isReady, isLoggedIn, error, session, sessionLoading, sessionError, reloadSession } =
    useLiffSession();
  const [board, setBoard] = useState<BoardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [addSheetOpen, setAddSheetOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newType, setNewType] = useState<ItemType>("other");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const [selectedItem, setSelectedItem] = useState<TripItem | null>(null);
  const [detailSheetOpen, setDetailSheetOpen] = useState(false);
  const [actioning, setActioning] = useState(false);

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<TripItem | null>(null);

  const loadBoard = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setActionError(null);

    try {
      const sessionData = await reloadSession();
      if (!sessionData) throw new Error("Failed to load session");

      if (!sessionData.activeTrip) {
        setBoard(null);
        return;
      }

      const boardRes = await liffFetch(`/api/liff/board?tripId=${sessionData.activeTrip.id}`);
      if (!boardRes.ok) throw new Error("Failed to load board");

      setBoard(await boardRes.json());
    } catch (err) {
      setLoadError(
        toLiffErrorMessage(
          "board",
          err,
          "We could not load the trip board. Pull to refresh or reopen this page in LINE."
        )
      );
    } finally {
      setLoading(false);
    }
  }, [reloadSession]);

  useEffect(() => {
    if (!isReady || !isLoggedIn || !session || sessionLoading) return;

    const activeTrip = session.activeTrip;

    if (!activeTrip) {
      setBoard(null);
      return;
    }

    void (async () => {
      setLoading(true);
      setLoadError(null);
      setActionError(null);
      try {
        const boardRes = await liffFetch(`/api/liff/board?tripId=${activeTrip.id}`);
        if (!boardRes.ok) throw new Error("Failed to load board");
        setBoard(await boardRes.json());
      } catch (err) {
        setLoadError(
          toLiffErrorMessage(
            "board",
            err,
            "We could not load the trip board. Pull to refresh or reopen this page in LINE."
          )
        );
      } finally {
        setLoading(false);
      }
    })();
  }, [isReady, isLoggedIn, session, sessionLoading]);

  async function handleAddItem() {
    if (!newTitle.trim() || !session?.activeTrip) return;

    setAdding(true);
    setAddError(null);

    try {
      const res = await liffFetch("/api/liff/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          tripId: session.activeTrip.id,
          title: newTitle.trim(),
          itemType: newType,
        }),
      });

      if (!res.ok) throw new Error("Failed to add item");

      setNewTitle("");
      setNewType("other");
      setAddSheetOpen(false);
      await loadBoard();
    } catch (err) {
      setAddError(
        toLiffErrorMessage(
          "create-item",
          err,
          "We could not add that item. Please try again."
        )
      );
    } finally {
      setAdding(false);
    }
  }

  async function handleReopen(itemId: string) {
    setActioning(true);
    setActionError(null);

    try {
      const res = await liffFetch("/api/liff/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reopen", itemId }),
      });

      if (!res.ok) throw new Error("Failed to reopen item");

      setDetailSheetOpen(false);
      await loadBoard();
    } catch (err) {
      setActionError(
        toLiffErrorMessage(
          "reopen-item",
          err,
          "We could not move that item back to To-Do. Please try again."
        )
      );
    } finally {
      setActioning(false);
    }
  }

  function openDeleteDialog(item: TripItem) {
    setItemToDelete(item);
    setDeleteDialogOpen(true);
  }

  async function confirmDelete() {
    if (!itemToDelete) return;

    setActioning(true);
    setActionError(null);

    try {
      const res = await liffFetch("/api/liff/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", itemId: itemToDelete.id }),
      });

      if (!res.ok && res.status !== 204) throw new Error("Failed to delete");

      setDeleteDialogOpen(false);
      setDetailSheetOpen(false);
      setItemToDelete(null);
      await loadBoard();
    } catch (err) {
      setActionError(
        toLiffErrorMessage(
          "delete-item",
          err,
          "We could not delete that item. Please try again."
        )
      );
      setDeleteDialogOpen(false);
    } finally {
      setActioning(false);
    }
  }

  if (!isReady) return <LoadingSpinner message="Initializing..." />;
  if (error) return <ErrorScreen message={error} />;
  if (!isLoggedIn) return <LoadingSpinner message="Logging in..." />;
  if (sessionLoading && !session) return <BoardSkeleton />;
  if (sessionError && !session) return <ErrorScreen message={sessionError} onRetry={loadBoard} />;
  if (loading) return <BoardSkeleton />;
  if (loadError) return <ErrorScreen message={loadError} onRetry={loadBoard} />;

  if (!board || !session?.activeTrip) {
    return (
      <EmptyState
        emoji="Trip"
        title="No active trip"
        description={
          <>
            Type{" "}
            <code className="font-mono bg-[var(--secondary)] px-1 py-0.5 rounded text-xs">
              /start [destination] [dates]
            </code>{" "}
            in the group chat to begin planning.
          </>
        }
      />
    );
  }

  const isOrganizer = session.member.role === "organizer";
  const totalItems = board.todo.length + board.pending.length + board.confirmed.length;

  return (
    <div className="max-w-md mx-auto">
      <div className="sticky top-0 z-10 bg-[var(--background)]/95 backdrop-blur-sm border-b border-[var(--border)] px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <h1 className="font-bold text-base truncate">{board.trip.destination_name}</h1>
            <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
              {board.trip.start_date && board.trip.end_date
                ? `${board.trip.start_date} to ${board.trip.end_date}`
                : `${totalItems} item${totalItems !== 1 ? "s" : ""} total`}
            </p>
          </div>
          {isOrganizer && (
            <Button
              size="sm"
              onClick={() => {
                setAddError(null);
                setAddSheetOpen(true);
              }}
              className="shrink-0 ml-3"
            >
              + Add
            </Button>
          )}
        </div>

        {totalItems > 0 && (
          <div className="mt-2.5 flex h-1 rounded-full overflow-hidden bg-[var(--border)]">
            {board.confirmed.length > 0 && (
              <div
                className="bg-[var(--primary)] transition-all duration-500"
                style={{ width: `${(board.confirmed.length / totalItems) * 100}%` }}
              />
            )}
            {board.pending.length > 0 && (
              <div
                className="bg-amber-400 transition-all duration-500"
                style={{ width: `${(board.pending.length / totalItems) * 100}%` }}
              />
            )}
          </div>
        )}
      </div>

      {actionError && <InlineError message={actionError} onDismiss={() => setActionError(null)} />}

      <div className="px-4 pt-4 space-y-3 pb-4">
        <BoardColumn
          title="To-Do"
          colorClass="text-[var(--muted-foreground)]"
          pillClass="bg-[var(--secondary)] text-[var(--muted-foreground)]"
          items={board.todo}
          emptyMessage="No open items. Add one above or type /add in chat."
          onItemClick={(item) => {
            setSelectedItem(item);
            setDetailSheetOpen(true);
          }}
        />
        <BoardColumn
          title="Pending Vote"
          colorClass="text-amber-600 dark:text-amber-400"
          pillClass="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
          items={board.pending}
          emptyMessage="No active votes. Type /vote [item] to start one."
          onItemClick={(item) => {
            setSelectedItem(item);
            setDetailSheetOpen(true);
          }}
        />
        <BoardColumn
          title="Confirmed"
          colorClass="text-[var(--primary)]"
          pillClass="bg-[#dcfce7] text-[#166534] dark:bg-[#14532d] dark:text-[#86efac]"
          items={board.confirmed}
          emptyMessage="Nothing confirmed yet."
          onItemClick={(item) => {
            setSelectedItem(item);
            setDetailSheetOpen(true);
          }}
        />
      </div>

      <Sheet
        open={addSheetOpen}
        onOpenChange={(open) => {
          setAddSheetOpen(open);
          if (!open) setAddError(null);
        }}
      >
        <SheetContent side="bottom" className="rounded-t-2xl">
          <SheetHeader className="mb-4">
            <SheetTitle>Add to-do item</SheetTitle>
          </SheetHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="item-title">Item name</Label>
              <Input
                id="item-title"
                placeholder="e.g. Book travel insurance"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void handleAddItem()}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={newType} onValueChange={(value) => setNewType(value as ItemType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ITEM_TYPES.map((type) => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {addError && <p className="text-xs text-destructive">{addError}</p>}
            <Button
              className="w-full"
              onClick={() => void handleAddItem()}
              disabled={adding || !newTitle.trim()}
            >
              {adding ? "Adding..." : "Add item"}
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {selectedItem && (
        <Sheet open={detailSheetOpen} onOpenChange={setDetailSheetOpen}>
          <SheetContent side="bottom" className="rounded-t-2xl">
            <SheetHeader className="mb-4">
              <SheetTitle className="flex items-center gap-2.5 text-left pr-6">
                <span className="leading-snug">{selectedItem.title}</span>
              </SheetTitle>
            </SheetHeader>

            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary" className="capitalize">
                  {ITEM_TYPE_LABELS[selectedItem.item_type]}
                </Badge>
                <Badge
                  variant={
                    selectedItem.stage === "confirmed"
                      ? "default"
                      : selectedItem.stage === "pending"
                        ? "outline"
                        : "secondary"
                  }
                  className="capitalize"
                >
                  {selectedItem.stage === "pending" ? "pending vote" : selectedItem.stage}
                </Badge>
              </div>

              {selectedItem.description && (
                <p className="text-sm text-[var(--muted-foreground)] leading-relaxed">
                  {selectedItem.description}
                </p>
              )}

              {selectedItem.deadline_at && (
                <div className="flex items-center gap-2 text-xs text-[var(--muted-foreground)] bg-[var(--secondary)] rounded-xl px-3 py-2">
                  <span>
                    Deadline:{" "}
                    {new Date(selectedItem.deadline_at).toLocaleString(undefined, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </span>
                </div>
              )}

              {isOrganizer && (
                <div className="flex flex-col gap-2 pt-1">
                  {(selectedItem.stage === "confirmed" || selectedItem.stage === "pending") && (
                    <Button
                      variant="outline"
                      onClick={() => void handleReopen(selectedItem.id)}
                      disabled={actioning}
                    >
                      {actioning ? "Moving..." : "Reopen (move to To-Do)"}
                    </Button>
                  )}
                  <Button
                    variant="destructive"
                    onClick={() => openDeleteDialog(selectedItem)}
                    disabled={actioning}
                  >
                    Delete item
                  </Button>
                </div>
              )}
            </div>
          </SheetContent>
        </Sheet>
      )}

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="mx-4 max-w-sm rounded-2xl">
          <DialogHeader>
            <DialogTitle>Delete item?</DialogTitle>
            <DialogDescription>
              &ldquo;{itemToDelete?.title}&rdquo; will be permanently removed from the trip board.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <DialogClose asChild>
              <Button variant="outline" disabled={actioning}>
                Cancel
              </Button>
            </DialogClose>
            <Button variant="destructive" onClick={() => void confirmDelete()} disabled={actioning}>
              {actioning ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function BoardColumn({
  title,
  colorClass,
  pillClass,
  items,
  emptyMessage,
  onItemClick,
}: {
  title: string;
  colorClass: string;
  pillClass: string;
  items: TripItem[];
  emptyMessage: string;
  onItemClick: (item: TripItem) => void;
}) {
  return (
    <div className="rounded-2xl border border-[var(--border)] overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 bg-[var(--secondary)] dark:bg-[#111]">
        <div className={cn("flex items-center gap-1.5 text-sm font-semibold", colorClass)}>
          <span>{title}</span>
        </div>
        <span className={cn("text-xs font-semibold px-2 py-0.5 rounded-full", pillClass)}>
          {items.length}
        </span>
      </div>

      <div className="divide-y divide-[var(--border)]">
        {items.length === 0 ? (
          <p className="px-4 py-3.5 text-xs text-[var(--muted-foreground)] italic">
            {emptyMessage}
          </p>
        ) : (
          items.map((item) => (
            <button
              key={item.id}
              onClick={() => onItemClick(item)}
              className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-[var(--secondary)] active:bg-[var(--secondary)] transition-colors"
            >
              <span className="flex-1 text-sm font-medium truncate">{item.title}</span>
              {item.deadline_at && (
                <span className="text-[10px] text-[var(--muted-foreground)] shrink-0 bg-[var(--secondary)] px-1.5 py-0.5 rounded-full">
                  {new Date(item.deadline_at).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}
                </span>
              )}
              <span className="text-[var(--muted-foreground)] text-sm shrink-0">{">"}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

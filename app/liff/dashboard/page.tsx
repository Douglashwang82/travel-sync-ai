"use client";

import { useEffect, useState, useCallback } from "react";
import { useLiff } from "@/components/liff-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import type { BoardData, TripItem, ItemType } from "@/lib/types";

const ITEM_TYPES: { value: ItemType; label: string }[] = [
  { value: "hotel", label: "Hotel" },
  { value: "restaurant", label: "Restaurant" },
  { value: "activity", label: "Activity" },
  { value: "transport", label: "Transport" },
  { value: "flight", label: "Flight" },
  { value: "insurance", label: "Insurance" },
  { value: "other", label: "Other" },
];

type SessionData = {
  group: { id: string; lineGroupId: string; name: string | null };
  member: { lineUserId: string; role: string };
  activeTrip: { id: string; destination_name: string; start_date: string | null; end_date: string | null } | null;
};

export default function DashboardPage() {
  const { isReady, isLoggedIn, profile, lineGroupId, error } = useLiff();
  const [session, setSession] = useState<SessionData | null>(null);
  const [board, setBoard] = useState<BoardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Add-item sheet state
  const [addSheetOpen, setAddSheetOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newType, setNewType] = useState<ItemType>("other");
  const [adding, setAdding] = useState(false);

  // Item detail sheet state
  const [selectedItem, setSelectedItem] = useState<TripItem | null>(null);
  const [detailSheetOpen, setDetailSheetOpen] = useState(false);
  const [actioning, setActioning] = useState(false);

  const loadBoard = useCallback(async () => {
    if (!profile || !lineGroupId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const sessionRes = await fetch(
        `/api/liff/session?lineGroupId=${encodeURIComponent(lineGroupId)}&lineUserId=${encodeURIComponent(profile.userId)}&displayName=${encodeURIComponent(profile.displayName)}`
      );
      if (!sessionRes.ok) throw new Error("Failed to load session");
      const sessionData: SessionData = await sessionRes.json();
      setSession(sessionData);

      if (!sessionData.activeTrip) {
        setBoard(null);
        return;
      }

      const boardRes = await fetch(`/api/liff/board?tripId=${sessionData.activeTrip.id}`);
      if (!boardRes.ok) throw new Error("Failed to load board");
      setBoard(await boardRes.json());
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [profile, lineGroupId]);

  useEffect(() => {
    if (isReady && isLoggedIn) loadBoard();
  }, [isReady, isLoggedIn, loadBoard]);

  async function handleAddItem() {
    if (!newTitle.trim() || !session?.activeTrip) return;
    setAdding(true);
    try {
      const res = await fetch("/api/liff/items", {
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
      alert(err instanceof Error ? err.message : "Error adding item");
    } finally {
      setAdding(false);
    }
  }

  async function handleReopen(itemId: string) {
    setActioning(true);
    try {
      const res = await fetch("/api/liff/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reopen", itemId }),
      });
      if (!res.ok) throw new Error("Failed to reopen item");
      setDetailSheetOpen(false);
      await loadBoard();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Error");
    } finally {
      setActioning(false);
    }
  }

  async function handleDelete(itemId: string) {
    if (!confirm("Delete this item?")) return;
    setActioning(true);
    try {
      const res = await fetch("/api/liff/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", itemId }),
      });
      if (!res.ok && res.status !== 204) throw new Error("Failed to delete");
      setDetailSheetOpen(false);
      await loadBoard();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Error");
    } finally {
      setActioning(false);
    }
  }

  // ── Render states ────────────────────────────────────────────────────────────

  if (!isReady) return <LoadingScreen message="Initializing..." />;
  if (error) return <ErrorScreen message={error} />;
  if (!isLoggedIn) return <LoadingScreen message="Logging in..." />;
  if (loading) return <LoadingScreen message="Loading trip board..." />;
  if (loadError) return <ErrorScreen message={loadError} onRetry={loadBoard} />;

  if (!board || !session?.activeTrip) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-6 text-center">
        <p className="text-4xl mb-3">✈️</p>
        <h2 className="text-lg font-semibold mb-1">No active trip</h2>
        <p className="text-sm text-muted-foreground">
          Type <span className="font-mono bg-secondary px-1 rounded">/start [destination] [dates]</span> in the group chat to begin.
        </p>
      </div>
    );
  }

  const isOrganizer = session.member.role === "organizer";

  return (
    <div className="max-w-md mx-auto p-4 pb-24 space-y-4">
      {/* Trip header */}
      <div className="pt-4 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold">✈️ {board.trip.destination_name}</h1>
          {board.trip.start_date && board.trip.end_date && (
            <p className="text-sm text-muted-foreground mt-0.5">
              {board.trip.start_date} → {board.trip.end_date}
            </p>
          )}
        </div>
        {isOrganizer && (
          <Button
            size="sm"
            onClick={() => setAddSheetOpen(true)}
            className="shrink-0"
          >
            + Add
          </Button>
        )}
      </div>

      <Separator />

      {/* Board columns */}
      <BoardColumn
        title="To-Do"
        emoji="📌"
        items={board.todo}
        badgeVariant="secondary"
        emptyMessage="No open items"
        onItemClick={(item) => { setSelectedItem(item); setDetailSheetOpen(true); }}
      />
      <BoardColumn
        title="Pending"
        emoji="⏳"
        items={board.pending}
        badgeVariant="outline"
        emptyMessage="No active votes"
        onItemClick={(item) => { setSelectedItem(item); setDetailSheetOpen(true); }}
      />
      <BoardColumn
        title="Confirmed"
        emoji="✅"
        items={board.confirmed}
        badgeVariant="default"
        emptyMessage="Nothing confirmed yet"
        onItemClick={(item) => { setSelectedItem(item); setDetailSheetOpen(true); }}
      />

      {/* Add-item sheet */}
      <Sheet open={addSheetOpen} onOpenChange={setAddSheetOpen}>
        <SheetContent side="bottom" className="rounded-t-2xl">
          <SheetHeader className="mb-4">
            <SheetTitle>Add To-Do item</SheetTitle>
          </SheetHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="item-title">Item</Label>
              <Input
                id="item-title"
                placeholder="e.g. Book travel insurance"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAddItem()}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={newType} onValueChange={(v) => setNewType(v as ItemType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ITEM_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              className="w-full"
              onClick={handleAddItem}
              disabled={adding || !newTitle.trim()}
            >
              {adding ? "Adding..." : "Add item"}
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* Item detail sheet */}
      {selectedItem && (
        <Sheet open={detailSheetOpen} onOpenChange={setDetailSheetOpen}>
          <SheetContent side="bottom" className="rounded-t-2xl">
            <SheetHeader className="mb-4">
              <SheetTitle>{selectedItem.title}</SheetTitle>
            </SheetHeader>
            <div className="space-y-3">
              <div className="flex gap-2 text-sm text-muted-foreground">
                <Badge variant="secondary" className="capitalize">
                  {selectedItem.item_type}
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
                  {selectedItem.stage}
                </Badge>
              </div>
              {selectedItem.description && (
                <p className="text-sm text-muted-foreground">{selectedItem.description}</p>
              )}
              {selectedItem.deadline_at && (
                <p className="text-xs text-muted-foreground">
                  Deadline: {new Date(selectedItem.deadline_at).toLocaleString()}
                </p>
              )}
              {isOrganizer && (
                <div className="flex flex-col gap-2 pt-2">
                  {(selectedItem.stage === "confirmed" || selectedItem.stage === "pending") && (
                    <Button
                      variant="outline"
                      onClick={() => handleReopen(selectedItem.id)}
                      disabled={actioning}
                    >
                      Reopen (move to To-Do)
                    </Button>
                  )}
                  <Button
                    variant="destructive"
                    onClick={() => handleDelete(selectedItem.id)}
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
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function BoardColumn({
  title,
  emoji,
  items,
  badgeVariant,
  emptyMessage,
  onItemClick,
}: {
  title: string;
  emoji: string;
  items: TripItem[];
  badgeVariant: "default" | "secondary" | "outline" | "destructive";
  emptyMessage: string;
  onItemClick: (item: TripItem) => void;
}) {
  return (
    <Card>
      <CardHeader className="pb-2 pt-4 px-4">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          {emoji} {title}
          <Badge variant={badgeVariant} className="ml-auto text-xs">
            {items.length}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">{emptyMessage}</p>
        ) : (
          <ul className="space-y-2">
            {items.map((item) => (
              <li key={item.id}>
                <button
                  onClick={() => onItemClick(item)}
                  className={cn(
                    "w-full text-left text-sm py-2 px-3 rounded-md bg-secondary",
                    "flex items-center gap-2 hover:bg-secondary/80 transition-colors active:scale-[0.99]"
                  )}
                >
                  <span className="capitalize text-xs text-muted-foreground w-16 shrink-0">
                    {item.item_type}
                  </span>
                  <span className="flex-1 font-medium">{item.title}</span>
                  <span className="text-muted-foreground text-xs shrink-0">›</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function LoadingScreen({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-3">
      <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

function ErrorScreen({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-6 text-center gap-3">
      <p className="text-2xl">⚠️</p>
      <p className="text-sm text-muted-foreground">{message}</p>
      {onRetry && (
        <button onClick={onRetry} className="text-sm text-primary underline underline-offset-2">
          Tap to retry
        </button>
      )}
    </div>
  );
}

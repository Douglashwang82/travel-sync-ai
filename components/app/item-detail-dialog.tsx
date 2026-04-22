"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { appFetchJson } from "@/lib/app-client";
import type { ItemType, TripItem } from "@/lib/types";
import type { AppMember } from "@/app/api/app/trips/[tripId]/members/route";

const ITEM_TYPE_OPTIONS: { value: ItemType; label: string }[] = [
  { value: "hotel", label: "Hotel" },
  { value: "restaurant", label: "Restaurant" },
  { value: "activity", label: "Activity" },
  { value: "transport", label: "Transport" },
  { value: "flight", label: "Flight" },
  { value: "insurance", label: "Insurance" },
  { value: "other", label: "Other" },
];

const UNASSIGNED = "__unassigned__";

function toInputLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ItemDetailDialog({
  tripId,
  item,
  members,
  isOrganizer,
  onOpenChange,
  onItemChanged,
  onItemDeleted,
}: {
  tripId: string;
  item: TripItem | null;
  members: AppMember[];
  isOrganizer: boolean;
  onOpenChange: (open: boolean) => void;
  onItemChanged: (item: TripItem) => void;
  onItemDeleted: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<ItemType>("other");
  const [deadline, setDeadline] = useState("");
  const [assignee, setAssignee] = useState<string>(UNASSIGNED);
  const [bookingRef, setBookingRef] = useState("");
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (item) {
      setTitle(item.title);
      setDescription(item.description ?? "");
      setType(item.item_type);
      setDeadline(toInputLocal(item.deadline_at));
      setAssignee(item.assigned_to_line_user_id ?? UNASSIGNED);
      setBookingRef("");
      setError(null);
      setConfirmDelete(false);
    }
  }, [item]);

  const open = item !== null;
  const isDirty =
    item !== null &&
    (title !== item.title ||
      description !== (item.description ?? "") ||
      type !== item.item_type ||
      deadline !== toInputLocal(item.deadline_at) ||
      assignee !== (item.assigned_to_line_user_id ?? UNASSIGNED));

  async function handleSave() {
    if (!item) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await appFetchJson<TripItem>(`/api/app/trips/${tripId}/items`, {
        method: "POST",
        body: JSON.stringify({
          action: "update",
          itemId: item.id,
          title: title.trim() || undefined,
          description: description.trim() ? description.trim() : null,
          itemType: type,
          deadlineAt: deadline ? new Date(deadline).toISOString() : null,
          assignedTo: assignee === UNASSIGNED ? null : assignee,
        }),
      });
      onItemChanged(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save changes");
    } finally {
      setSaving(false);
    }
  }

  async function handleReopen() {
    if (!item) return;
    setBusy("reopen");
    setError(null);
    try {
      const updated = await appFetchJson<TripItem>(`/api/app/trips/${tripId}/items`, {
        method: "POST",
        body: JSON.stringify({ action: "reopen", itemId: item.id }),
      });
      onItemChanged(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reopen");
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete() {
    if (!item) return;
    setBusy("delete");
    setError(null);
    try {
      await appFetchJson(`/api/app/trips/${tripId}/items`, {
        method: "POST",
        body: JSON.stringify({ action: "delete", itemId: item.id }),
      });
      onItemDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
    } finally {
      setBusy(null);
    }
  }

  async function handleMarkBooked() {
    if (!item || !bookingRef.trim()) return;
    setBusy("book");
    setError(null);
    try {
      const updated = await appFetchJson<TripItem>(`/api/app/trips/${tripId}/items`, {
        method: "POST",
        body: JSON.stringify({
          action: "mark_booked",
          itemId: item.id,
          bookingRef: bookingRef.trim(),
        }),
      });
      setBookingRef("");
      onItemChanged(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to mark as booked");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        {item && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 pr-6 text-left">
                {item.title}
              </DialogTitle>
              <DialogDescription>
                Edit details, assign a member, or move this item between columns.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline" className="capitalize">
                  {item.stage === "pending" ? "pending vote" : item.stage}
                </Badge>
                {item.stage === "confirmed" && item.booking_status === "needed" && (
                  <Badge className="border-0 bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                    Booking needed
                  </Badge>
                )}
                {item.stage === "confirmed" && item.booking_status === "booked" && (
                  <Badge className="border-0 bg-[#dcfce7] text-[#166534] dark:bg-[#14532d] dark:text-[#86efac]">
                    Booked ✓
                  </Badge>
                )}
                {item.booking_ref && (
                  <span className="truncate rounded-full bg-[var(--secondary)] px-2 py-0.5 text-[11px] text-[var(--muted-foreground)]">
                    Ref: {item.booking_ref}
                  </span>
                )}
              </div>

              {isOrganizer ? (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="item-title">Title</Label>
                    <Input
                      id="item-title"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label>Type</Label>
                      <Select value={type} onValueChange={(v) => setType(v as ItemType)}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ITEM_TYPE_OPTIONS.map((o) => (
                            <SelectItem key={o.value} value={o.value}>
                              {o.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="item-deadline">Deadline</Label>
                      <Input
                        id="item-deadline"
                        type="datetime-local"
                        value={deadline}
                        onChange={(e) => setDeadline(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="item-description">Description</Label>
                    <Textarea
                      id="item-description"
                      rows={3}
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label>Assigned to</Label>
                    <Select value={assignee} onValueChange={setAssignee}>
                      <SelectTrigger>
                        <SelectValue placeholder="Unassigned" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                        {members.map((m) => (
                          <SelectItem key={m.lineUserId} value={m.lineUserId}>
                            {m.displayName ?? m.lineUserId}
                            {m.role === "organizer" ? " · organizer" : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </>
              ) : (
                <div className="space-y-2 text-sm text-[var(--muted-foreground)]">
                  {item.description && <p>{item.description}</p>}
                  {item.deadline_at && (
                    <p>
                      Deadline:{" "}
                      {new Date(item.deadline_at).toLocaleString(undefined, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </p>
                  )}
                  <p>
                    Assigned to:{" "}
                    {item.assigned_to_line_user_id
                      ? (members.find((m) => m.lineUserId === item.assigned_to_line_user_id)
                          ?.displayName ?? item.assigned_to_line_user_id)
                      : "Unassigned"}
                  </p>
                </div>
              )}

              {item.stage === "confirmed" && item.booking_status === "needed" && (
                <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 dark:border-amber-900/50 dark:bg-amber-950/30">
                  <p className="text-xs font-medium text-amber-700 dark:text-amber-300">
                    Booking not yet confirmed
                  </p>
                  <div className="space-y-1.5">
                    <Label htmlFor="booking-ref" className="text-xs">
                      Confirmation number or URL
                    </Label>
                    <Input
                      id="booking-ref"
                      placeholder="e.g. AX-12345 or https://…"
                      value={bookingRef}
                      onChange={(e) => setBookingRef(e.target.value)}
                      className="text-sm"
                    />
                  </div>
                  <Button
                    size="sm"
                    onClick={() => void handleMarkBooked()}
                    disabled={busy === "book" || !bookingRef.trim()}
                    className="w-full"
                  >
                    {busy === "book" ? "Saving..." : "Mark as booked"}
                  </Button>
                </div>
              )}

              {error && <p className="text-xs text-destructive">{error}</p>}

              {isOrganizer && confirmDelete && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-3 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
                  Permanently delete &ldquo;{item.title}&rdquo;? This cannot be undone.
                  <div className="mt-2 flex justify-end gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setConfirmDelete(false)}
                      disabled={busy === "delete"}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => void handleDelete()}
                      disabled={busy === "delete"}
                    >
                      {busy === "delete" ? "Deleting..." : "Delete"}
                    </Button>
                  </div>
                </div>
              )}
            </div>

            <DialogFooter className="flex-wrap gap-2 sm:justify-between">
              {isOrganizer ? (
                <div className="flex flex-wrap gap-2">
                  {(item.stage === "confirmed" || item.stage === "pending") && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void handleReopen()}
                      disabled={busy === "reopen"}
                    >
                      {busy === "reopen" ? "Moving..." : "Move to To-Do"}
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setConfirmDelete(true)}
                    disabled={confirmDelete}
                    className="text-destructive"
                  >
                    Delete
                  </Button>
                </div>
              ) : (
                <span />
              )}
              <div className="flex items-center gap-2">
                <DialogClose asChild>
                  <Button variant="outline" size="sm">
                    Close
                  </Button>
                </DialogClose>
                {isOrganizer && (
                  <Button
                    size="sm"
                    onClick={() => void handleSave()}
                    disabled={saving || !isDirty || !title.trim()}
                  >
                    {saving ? "Saving..." : "Save changes"}
                  </Button>
                )}
              </div>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

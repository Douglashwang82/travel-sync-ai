"use client";

import { useState } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { appFetchJson } from "@/lib/app-client";
import type { ItemType } from "@/lib/types";

const ITEM_TYPE_OPTIONS: { value: ItemType; label: string }[] = [
  { value: "hotel", label: "Hotel" },
  { value: "restaurant", label: "Restaurant" },
  { value: "activity", label: "Activity" },
  { value: "transport", label: "Transport" },
  { value: "flight", label: "Flight" },
  { value: "insurance", label: "Insurance" },
  { value: "other", label: "Other" },
];

export function AddItemDialog({
  tripId,
  open,
  onOpenChange,
  onCreated,
}: {
  tripId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [type, setType] = useState<ItemType>("other");
  const [description, setDescription] = useState("");
  const [deadline, setDeadline] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setTitle("");
    setType("other");
    setDescription("");
    setDeadline("");
    setError(null);
  }

  async function handleSubmit() {
    if (!title.trim()) return;

    setSubmitting(true);
    setError(null);

    try {
      await appFetchJson(`/api/app/trips/${tripId}/items`, {
        method: "POST",
        body: JSON.stringify({
          action: "create",
          title: title.trim(),
          itemType: type,
          description: description.trim() || undefined,
          deadlineAt: deadline ? new Date(deadline).toISOString() : null,
        }),
      });
      reset();
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create item");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) reset();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add a trip item</DialogTitle>
          <DialogDescription>
            Add a to-do, a decision to vote on, or a booking reminder. Items land in the
            To-Do column.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="add-item-title">Title</Label>
            <Input
              id="add-item-title"
              placeholder="e.g. Book travel insurance"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
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
              <Label htmlFor="add-item-deadline">Deadline</Label>
              <Input
                id="add-item-deadline"
                type="datetime-local"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="add-item-description">Description (optional)</Label>
            <Textarea
              id="add-item-description"
              placeholder="Extra context — e.g. needs approval from everyone"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <DialogClose asChild>
            <Button variant="outline" disabled={submitting}>
              Cancel
            </Button>
          </DialogClose>
          <Button onClick={() => void handleSubmit()} disabled={submitting || !title.trim()}>
            {submitting ? "Adding..." : "Add item"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

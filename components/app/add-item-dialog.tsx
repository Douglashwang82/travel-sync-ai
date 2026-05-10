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
import { PlacePicker, type PickedPlace } from "@/components/app/place-picker";
import type { ItemType } from "@/lib/types";

const ITEM_TYPE_OPTIONS: { value: ItemType; label: string }[] = [
  { value: "hotel", label: "住宿" },
  { value: "restaurant", label: "餐廳" },
  { value: "activity", label: "活動" },
  { value: "transport", label: "交通" },
  { value: "flight", label: "航班" },
  { value: "insurance", label: "保險" },
  { value: "other", label: "其他" },
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
  const [place, setPlace] = useState<PickedPlace | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setTitle("");
    setType("other");
    setDescription("");
    setDeadline("");
    setPlace(null);
    setError(null);
  }

  function handlePlacePicked(p: PickedPlace | null) {
    setPlace(p);
    if (p && !title.trim()) setTitle(p.name);
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
          place:
            place && place.lat != null && place.lng != null
              ? {
                  name: place.name,
                  address: place.address,
                  lat: place.lat,
                  lng: place.lng,
                  googleMapsUrl: place.googleMapsUrl,
                }
              : undefined,
        }),
      });
      reset();
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "新增項目失敗");
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
          <DialogTitle>新增旅程項目</DialogTitle>
          <DialogDescription>
            新增待辦、需要投票的決策，或預訂提醒。項目會先進入待辦欄。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="add-item-title">標題</Label>
            <Input
              id="add-item-title"
              placeholder="例如：預訂旅遊保險"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="add-item-place">選擇地點（選填）</Label>
            <PlacePicker
              inputId="add-item-place"
              value={place}
              onChange={handlePlacePicked}
              placeholder="搜尋 Google 上的飯店、餐廳或景點..."
            />
            <p className="text-[11px] text-muted-foreground">
              附上地點後，這個項目會出現在旅程地圖上。
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>類型</Label>
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
              <Label htmlFor="add-item-deadline">截止時間</Label>
              <Input
                id="add-item-deadline"
                type="datetime-local"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="add-item-description">描述（選填）</Label>
            <Textarea
              id="add-item-description"
              placeholder="補充說明，例如：需要大家同意"
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
              取消
            </Button>
          </DialogClose>
          <Button onClick={() => void handleSubmit()} disabled={submitting || !title.trim()}>
            {submitting ? "新增中..." : "新增項目"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { appFetchJson, AppApiFetchError } from "@/lib/app-client";
import { cn } from "@/lib/utils";
import type {
  WebActiveVote,
  WebVoteOption,
} from "@/app/api/app/trips/[tripId]/votes/route";
import type { OptionDetailResponse } from "@/app/api/app/trips/[tripId]/items/[itemId]/options/[optionId]/route";

interface EditState {
  name: string;
  address: string;
  imageUrl: string;
  bookingUrl: string;
  googleMapsUrl: string;
  priceLevel: string;
  rating: string;
  notes: string;
}

function toEditState(opt: WebVoteOption): EditState {
  return {
    name: opt.name,
    address: opt.address ?? "",
    imageUrl: opt.imageUrl ?? "",
    bookingUrl: opt.bookingUrl ?? "",
    googleMapsUrl: opt.googleMapsUrl ?? "",
    priceLevel: opt.priceLevel ?? "",
    rating: opt.rating != null ? String(opt.rating) : "",
    notes: opt.notes ?? "",
  };
}

export function OptionDetailDialog({
  tripId,
  vote,
  option,
  onClose,
  onVote,
  onUpdated,
}: {
  tripId: string;
  vote: WebActiveVote;
  option: WebVoteOption | null;
  onClose: () => void;
  onVote: (optionId: string) => void;
  onUpdated: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<EditState>(() =>
    option ? toEditState(option) : toEditState({} as WebVoteOption)
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [voting, setVoting] = useState(false);

  useEffect(() => {
    if (option) {
      setDraft(toEditState(option));
      setEditing(false);
      setSaveError(null);
    }
  }, [option]);

  async function handleSave() {
    if (!option) return;
    setSaving(true);
    setSaveError(null);
    try {
      const ratingNum =
        draft.rating.trim() === "" ? null : Number(draft.rating);
      if (ratingNum != null && (Number.isNaN(ratingNum) || ratingNum < 0 || ratingNum > 5)) {
        throw new Error("評分必須是 0 到 5 之間的數字");
      }
      const payload = {
        name: draft.name.trim(),
        address: draft.address.trim() || null,
        imageUrl: draft.imageUrl.trim() || null,
        bookingUrl: draft.bookingUrl.trim() || null,
        googleMapsUrl: draft.googleMapsUrl.trim() || null,
        priceLevel: draft.priceLevel.trim() || null,
        rating: ratingNum,
        notes: draft.notes.trim() || null,
      };
      await appFetchJson<OptionDetailResponse>(
        `/api/app/trips/${tripId}/items/${vote.item.id}/options/${option.id}`,
        {
          method: "PATCH",
          body: JSON.stringify(payload),
        }
      );
      setEditing(false);
      onUpdated();
    } catch (err) {
      setSaveError(
        err instanceof AppApiFetchError
          ? err.message
          : err instanceof Error
            ? err.message
            : "儲存失敗"
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleVote() {
    if (!option) return;
    setVoting(true);
    try {
      onVote(option.id);
    } finally {
      // Parent loads after voting; close after a beat for feedback.
      setTimeout(() => setVoting(false), 250);
    }
  }

  const open = option !== null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        {option && (
          <>
            <DialogHeader>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary" className="text-[10px] uppercase">
                  選項
                </Badge>
                {option.votedByMe && (
                  <span className="rounded-full bg-[var(--primary)] px-2 py-0.5 text-[10px] font-semibold text-white">
                    你的選擇
                  </span>
                )}
                <span className="text-[11px] text-[var(--muted-foreground)]">
                  {option.voteCount} 票
                </span>
              </div>
              <DialogTitle className="mt-1.5">{option.name}</DialogTitle>
              <DialogDescription className="text-xs">
                正在為「{vote.item.title}」投票。群組成員都可以補充價格、地點或體驗備註。
              </DialogDescription>
            </DialogHeader>

            {!editing ? (
              <ReadView
                option={option}
                onEdit={() => {
                  setDraft(toEditState(option));
                  setEditing(true);
                }}
              />
            ) : (
              <EditView
                draft={draft}
                onChange={setDraft}
                saving={saving}
                error={saveError}
              />
            )}

            <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:justify-between">
              {!editing ? (
                <>
                  <Button
                    variant="outline"
                    onClick={onClose}
                    className="sm:order-1"
                  >
                    關閉
                  </Button>
                  <Button
                    onClick={() => void handleVote()}
                    disabled={voting}
                    className={cn(
                      "sm:order-2",
                      option.votedByMe && "bg-emerald-600 hover:bg-emerald-700"
                    )}
                  >
                    {voting
                      ? "儲存中..."
                      : option.votedByMe
                        ? "已投票，點一下可更改"
                        : "投給這個選項"}
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    variant="outline"
                    onClick={() => setEditing(false)}
                    disabled={saving}
                    className="sm:order-1"
                  >
                    取消
                  </Button>
                  <Button
                    onClick={() => void handleSave()}
                    disabled={saving || draft.name.trim() === ""}
                    className="sm:order-2"
                  >
                    {saving ? "儲存中..." : "儲存詳情"}
                  </Button>
                </>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ReadView({
  option,
  onEdit,
}: {
  option: WebVoteOption;
  onEdit: () => void;
}) {
  const hasFacts =
    option.address ||
    option.priceLevel ||
    option.rating != null ||
    option.googleMapsUrl ||
    option.bookingUrl;

  return (
    <div className="space-y-4">
      {option.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={option.imageUrl}
          alt={option.name}
          className="h-44 w-full rounded-xl object-cover"
        />
      )}

      {hasFacts && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
          {option.address && (
            <Fact label="地點" full>
              <span className="text-[var(--foreground)]">📍 {option.address}</span>
            </Fact>
          )}
          {option.priceLevel && (
            <Fact label="價格">
              <span className="font-semibold">{option.priceLevel}</span>
            </Fact>
          )}
          {option.rating != null && (
            <Fact label="評分">
              <span className="font-semibold">★ {option.rating}</span>
            </Fact>
          )}
          {option.googleMapsUrl && (
            <Fact label="地圖">
              <a
                href={option.googleMapsUrl}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-[var(--primary)] underline-offset-2 hover:underline"
              >
                在地圖開啟
              </a>
            </Fact>
          )}
          {option.bookingUrl && (
            <Fact label="預訂">
              <a
                href={option.bookingUrl}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-[var(--primary)] underline-offset-2 hover:underline"
              >
                開啟預訂頁
              </a>
            </Fact>
          )}
        </dl>
      )}

      <section className="rounded-xl border border-[var(--border)] bg-[var(--secondary)]/30 p-3">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
            群組備註與體驗
          </p>
          <button
            type="button"
            onClick={onEdit}
            className="text-[11px] font-medium text-[var(--primary)] hover:underline"
          >
            {option.notes ? "編輯" : "新增備註"}
          </button>
        </div>
        {option.notes ? (
          <>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">
              {option.notes}
            </p>
            {option.notesUpdatedByName && option.notesUpdatedAt && (
              <p className="mt-2 text-[10px] text-[var(--muted-foreground)]">
                最後由{" "}
                <span className="font-medium">{option.notesUpdatedByName}</span>
                {" 更新 · "}
                {new Date(option.notesUpdatedAt).toLocaleDateString("zh-TW", {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
            )}
          </>
        ) : (
          <p className="mt-2 text-xs italic text-[var(--muted-foreground)]">
            還沒有備註。點「新增備註」分享價格、地址、個人體驗，或任何群組該知道的資訊。
          </p>
        )}
      </section>

      {option.voters.length > 0 && (
        <section>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
            已投票
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {option.voters.map((v) => (
              <span
                key={v.lineUserId}
                className="inline-flex items-center gap-1 rounded-full bg-[var(--primary)]/10 px-2 py-0.5 text-[11px] font-medium text-[var(--primary)]"
              >
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[var(--primary)]/20 text-[8px] font-bold">
                  {(v.displayName ?? "?").slice(0, 1).toUpperCase()}
                </span>
                {v.displayName ?? v.lineUserId.slice(0, 6)}
              </span>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function Fact({
  label,
  children,
  full,
}: {
  label: string;
  children: React.ReactNode;
  full?: boolean;
}) {
  return (
    <div className={full ? "col-span-2" : "col-span-1"}>
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
        {label}
      </dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}

function EditView({
  draft,
  onChange,
  saving,
  error,
}: {
  draft: EditState;
  onChange: (next: EditState) => void;
  saving: boolean;
  error: string | null;
}) {
  function patch<K extends keyof EditState>(key: K, value: EditState[K]) {
    onChange({ ...draft, [key]: value });
  }

  return (
    <fieldset disabled={saving} className="space-y-3">
      <p className="rounded-lg bg-[var(--primary)]/5 px-3 py-2 text-[11px] text-[var(--muted-foreground)]">
        群組成員都可以更新這些資訊，讓大家一起做決定。
      </p>

      <div className="space-y-1.5">
        <Label htmlFor="opt-name" className="text-xs">
          名稱
        </Label>
        <Input
          id="opt-name"
          value={draft.name}
          onChange={(e) => patch("name", e.target.value)}
          maxLength={200}
          required
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <Label htmlFor="opt-price" className="text-xs">
            價格
          </Label>
          <Input
            id="opt-price"
            value={draft.priceLevel}
            placeholder="例如：JPY 18,000/晚、$$"
            onChange={(e) => patch("priceLevel", e.target.value)}
            maxLength={40}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="opt-rating" className="text-xs">
            評分（0-5）
          </Label>
          <Input
            id="opt-rating"
            value={draft.rating}
            type="number"
            min={0}
            max={5}
            step={0.1}
            placeholder="例如：4.5"
            onChange={(e) => patch("rating", e.target.value)}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="opt-address" className="text-xs">
          地址 / 地點
        </Label>
        <Input
          id="opt-address"
          value={draft.address}
          placeholder="街道、區域或地點名稱"
          onChange={(e) => patch("address", e.target.value)}
          maxLength={400}
        />
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="opt-map" className="text-xs">
            地圖 URL
          </Label>
          <Input
            id="opt-map"
            value={draft.googleMapsUrl}
            placeholder="https://maps.google.com/..."
            onChange={(e) => patch("googleMapsUrl", e.target.value)}
            maxLength={1000}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="opt-booking" className="text-xs">
            預訂 URL
          </Label>
          <Input
            id="opt-booking"
            value={draft.bookingUrl}
            placeholder="https://..."
            onChange={(e) => patch("bookingUrl", e.target.value)}
            maxLength={1000}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="opt-image" className="text-xs">
          圖片 URL
        </Label>
        <Input
          id="opt-image"
          value={draft.imageUrl}
          placeholder="https://..."
          onChange={(e) => patch("imageUrl", e.target.value)}
          maxLength={1000}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="opt-notes" className="text-xs">
          備註與體驗
        </Label>
        <Textarea
          id="opt-notes"
          value={draft.notes}
          rows={4}
          placeholder="任何群組該知道的資訊：你的體驗、推薦原因、注意事項、誰推薦的..."
          onChange={(e) => patch("notes", e.target.value)}
          maxLength={2000}
        />
        <p className="text-[10px] text-[var(--muted-foreground)]">
          還可輸入 {2000 - draft.notes.length} 字
        </p>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}
    </fieldset>
  );
}

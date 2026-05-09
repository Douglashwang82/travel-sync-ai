"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  Circle,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  User,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { appFetchJson } from "@/lib/app-client";
import { cn } from "@/lib/utils";
import {
  TabPageHeader,
  TabError,
  TabSkeleton,
} from "@/components/app/tab-shell";
import {
  APP_PACK_CATEGORIES,
  type AppGroupPackItem,
  type AppPackCategory,
  type AppPackResponse,
  type AppPackScope,
  type AppPersonalPackItem,
} from "@/lib/app-pack";

const CATEGORY_LABEL: Record<AppPackCategory, string> = {
  documents: "Documents",
  clothing: "Clothing",
  toiletries: "Toiletries",
  electronics: "Electronics",
  health: "Health",
  safety: "Safety",
  general: "General",
};

const CATEGORY_BADGE: Record<AppPackCategory, string> = {
  documents: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
  clothing: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  toiletries: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300",
  electronics: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
  health: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
  safety: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  general: "bg-[var(--surface-sunken)] text-[var(--text-muted)]",
};

type Filter = AppPackCategory | "all";

export function TripPackClient({ tripId }: { tripId: string }) {
  const [data, setData] = useState<AppPackResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState<AppPackScope>("group");
  const [filter, setFilter] = useState<Filter>("all");
  const [addOpen, setAddOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [category, setCategory] = useState<AppPackCategory>("general");
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyItem, setBusyItem] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await appFetchJson<AppPackResponse>(
        `/api/app/trips/${tripId}/pack`
      );
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load packing list");
    }
  }, [tripId]);

  useEffect(() => {
    void load();
  }, [load]);

  const groupProgress = progress(data?.groupPackedCount ?? 0, data?.groupItems.length ?? 0);
  const personalProgress = progress(
    data?.personalPackedCount ?? 0,
    data?.personalItems.length ?? 0
  );

  const activeItems = useMemo(() => {
    if (!data) return [];
    const items = scope === "group" ? data.groupItems : data.personalItems;
    if (filter === "all") return items;
    return items.filter((item) => item.category === filter);
  }, [data, filter, scope]);

  const counts = useMemo(() => {
    const map: Record<Filter, number> = {
      all: 0,
      documents: 0,
      clothing: 0,
      toiletries: 0,
      electronics: 0,
      health: 0,
      safety: 0,
      general: 0,
    };
    const items = scope === "group" ? data?.groupItems : data?.personalItems;
    for (const item of items ?? []) {
      map.all += 1;
      map[item.category] += 1;
    }
    return map;
  }, [data, scope]);

  async function handleAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = label.trim();
    if (!trimmed) {
      setActionError("Enter an item to pack.");
      return;
    }

    setSubmitting(true);
    setActionError(null);
    try {
      await appFetchJson(`/api/app/trips/${tripId}/pack`, {
        method: "POST",
        body: JSON.stringify({ scope, label: trimmed, category }),
      });
      setLabel("");
      setCategory("general");
      setAddOpen(false);
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to add item");
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleItem(
    item: AppGroupPackItem | AppPersonalPackItem,
    nextPacked: boolean
  ) {
    setBusyItem(item.id);
    setActionError(null);
    try {
      await appFetchJson(`/api/app/trips/${tripId}/pack/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({ scope, isPacked: nextPacked }),
      });
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to update item");
    } finally {
      setBusyItem(null);
    }
  }

  async function deleteItem(item: AppGroupPackItem | AppPersonalPackItem) {
    if (!confirm(`Delete "${item.label}" from this packing list?`)) return;
    setBusyItem(item.id);
    setActionError(null);
    try {
      await appFetchJson(
        `/api/app/trips/${tripId}/pack/${item.id}?scope=${scope}`,
        { method: "DELETE" }
      );
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to delete item");
    } finally {
      setBusyItem(null);
    }
  }

  if (error && !data) {
    return <TabError message={error} onRetry={() => void load()} />;
  }

  if (!data) {
    return <TabSkeleton />;
  }

  const currentProgress = scope === "group" ? groupProgress : personalProgress;

  return (
    <div className="space-y-6">
      <TabPageHeader
        title="Pack"
        subtitle="Track the group checklist and your private bag list for this trip."
        actions={
          <>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void load()}
              title="Refresh packing list"
            >
              <RefreshCw />
            </Button>
            <Button size="sm" onClick={() => setAddOpen(true)}>
              <Plus />
              Add item
            </Button>
          </>
        }
      />

      <div className="grid gap-4 md:grid-cols-2">
        <ProgressPanel
          icon={<Users className="size-4" />}
          title="Group list"
          subtitle="Visible to everyone in the trip group"
          packed={data.groupPackedCount}
          total={data.groupItems.length}
          active={scope === "group"}
          onClick={() => setScope("group")}
        />
        <ProgressPanel
          icon={<User className="size-4" />}
          title="My bag"
          subtitle="Private to your app account"
          packed={data.personalPackedCount}
          total={data.personalItems.length}
          active={scope === "mine"}
          onClick={() => setScope("mine")}
        />
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <FilterChip
            label={`All / ${counts.all}`}
            active={filter === "all"}
            onClick={() => setFilter("all")}
          />
          {APP_PACK_CATEGORIES.map((itemCategory) => (
            <FilterChip
              key={itemCategory}
              label={`${CATEGORY_LABEL[itemCategory]} / ${counts[itemCategory]}`}
              active={filter === itemCategory}
              onClick={() => setFilter(itemCategory)}
            />
          ))}
        </div>

        <section className="surface-tile p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-hairline)] pb-4">
            <div>
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                {scope === "group" ? "Group packing list" : "My packing list"}
              </h3>
              <p className="text-mono text-xs text-[var(--text-muted)]">
                {currentProgress.packed}/{currentProgress.total} packed
              </p>
            </div>
            <div className="h-2 w-36 overflow-hidden rounded-full bg-[var(--surface-sunken)]">
              <div
                className="h-full rounded-full bg-[var(--accent-line)] transition-all"
                style={{ width: `${currentProgress.pct}%` }}
              />
            </div>
          </div>

          {actionError && (
            <p className="mt-3 rounded-xl border border-[var(--status-blocked)] bg-[var(--status-blocked-soft)] px-3 py-2 text-xs text-[var(--status-blocked)]">
              {actionError}
            </p>
          )}

          {activeItems.length === 0 ? (
            <div className="px-4 py-12 text-center text-sm text-[var(--text-muted)]">
              {counts.all === 0
                ? "No packing items yet."
                : "No packing items in this category."}
            </div>
          ) : (
            <ul className="divide-y divide-[var(--border-hairline)]">
              {activeItems.map((item) =>
                scope === "group" ? (
                  <GroupPackRow
                    key={item.id}
                    item={item as AppGroupPackItem}
                    busy={busyItem === item.id}
                    onToggle={(nextPacked) => void toggleItem(item, nextPacked)}
                    onDelete={() => void deleteItem(item)}
                  />
                ) : (
                  <PersonalPackRow
                    key={item.id}
                    item={item as AppPersonalPackItem}
                    busy={busyItem === item.id}
                    onToggle={(nextPacked) => void toggleItem(item, nextPacked)}
                    onDelete={() => void deleteItem(item)}
                  />
                )
              )}
            </ul>
          )}
        </section>
      </div>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-md">
          <form onSubmit={handleAdd}>
            <DialogHeader>
              <DialogTitle>Add packing item</DialogTitle>
              <DialogDescription>
                Add it to the selected list: group shared or private.
              </DialogDescription>
            </DialogHeader>

            <div className="mt-4 space-y-4">
              <div className="grid grid-cols-2 gap-2 rounded-lg bg-[var(--surface-sunken)] p-1">
                <button
                  type="button"
                  onClick={() => setScope("group")}
                  className={cn(
                    "inline-flex h-9 items-center justify-center gap-2 rounded-md text-sm font-medium",
                    scope === "group"
                      ? "bg-[var(--surface-raised)] text-[var(--text-primary)] shadow-sm"
                      : "text-[var(--text-muted)]"
                  )}
                >
                  <Users className="size-4" />
                  Group
                </button>
                <button
                  type="button"
                  onClick={() => setScope("mine")}
                  className={cn(
                    "inline-flex h-9 items-center justify-center gap-2 rounded-md text-sm font-medium",
                    scope === "mine"
                      ? "bg-[var(--surface-raised)] text-[var(--text-primary)] shadow-sm"
                      : "text-[var(--text-muted)]"
                  )}
                >
                  <User className="size-4" />
                  Mine
                </button>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="pack-label">Item</Label>
                <Input
                  id="pack-label"
                  value={label}
                  onChange={(event) => setLabel(event.target.value)}
                  placeholder="Passport, charger, rain jacket"
                  maxLength={120}
                  disabled={submitting}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="pack-category">Category</Label>
                <Select
                  value={category}
                  onValueChange={(value) => setCategory(value as AppPackCategory)}
                >
                  <SelectTrigger id="pack-category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {APP_PACK_CATEGORIES.map((itemCategory) => (
                      <SelectItem key={itemCategory} value={itemCategory}>
                        {CATEGORY_LABEL[itemCategory]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {actionError && (
              <p className="mt-3 text-xs text-[var(--status-blocked)]">{actionError}</p>
            )}

            <DialogFooter className="mt-6">
              <DialogClose asChild>
                <Button type="button" variant="outline" disabled={submitting}>
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit" disabled={submitting || !label.trim()}>
                {submitting && <Loader2 className="animate-spin" />}
                Add item
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ProgressPanel({
  icon,
  title,
  subtitle,
  packed,
  total,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  packed: number;
  total: number;
  active: boolean;
  onClick: () => void;
}) {
  const p = progress(packed, total);
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "surface-tile tile-interactive p-5 text-left",
        active
          ? "border-[var(--accent-line)] shadow-[var(--shadow-raise)]"
          : ""
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
            {icon}
            {title}
          </div>
          <p className="mt-1 text-xs text-[var(--text-muted)]">{subtitle}</p>
        </div>
        <span className="text-mono text-display text-lg text-[var(--text-primary)]">
          {packed}/{total}
        </span>
      </div>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-[var(--surface-sunken)]">
        <div
          className="h-full rounded-full bg-[var(--accent-line)] transition-all"
          style={{ width: `${p.pct}%` }}
        />
      </div>
    </button>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1 font-medium transition-colors",
        active
          ? "border-[var(--accent-line)] bg-[var(--accent-line-soft)] text-[var(--accent-line)]"
          : "border-[var(--border-hairline)] text-[var(--text-muted)] hover:bg-[var(--surface-sunken)]"
      )}
    >
      {label}
    </button>
  );
}

function GroupPackRow({
  item,
  busy,
  onToggle,
  onDelete,
}: {
  item: AppGroupPackItem;
  busy: boolean;
  onToggle: (nextPacked: boolean) => void;
  onDelete: () => void;
}) {
  return (
    <li className="flex items-center gap-3 py-3">
      <PackToggle
        packed={item.isPackedByMe}
        busy={busy}
        label={item.label}
        onClick={() => onToggle(!item.isPackedByMe)}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "truncate text-sm font-medium",
              item.isPackedByMe && "text-[var(--text-muted)] line-through"
            )}
          >
            {item.label}
          </span>
          <Badge
            variant="secondary"
            className={cn("border-0 text-[10px]", CATEGORY_BADGE[item.category])}
          >
            {CATEGORY_LABEL[item.category]}
          </Badge>
        </div>
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          {item.packedCount} packed
          {item.addedByName ? ` / added by ${item.addedByName}` : ""}
        </p>
      </div>
      {item.canDelete && (
        <IconButton
          title={`Delete ${item.label}`}
          disabled={busy}
          onClick={onDelete}
        />
      )}
    </li>
  );
}

function PersonalPackRow({
  item,
  busy,
  onToggle,
  onDelete,
}: {
  item: AppPersonalPackItem;
  busy: boolean;
  onToggle: (nextPacked: boolean) => void;
  onDelete: () => void;
}) {
  return (
    <li className="flex items-center gap-3 py-3">
      <PackToggle
        packed={item.isPacked}
        busy={busy}
        label={item.label}
        onClick={() => onToggle(!item.isPacked)}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "truncate text-sm font-medium",
              item.isPacked && "text-[var(--text-muted)] line-through"
            )}
          >
            {item.label}
          </span>
          <Badge
            variant="secondary"
            className={cn("border-0 text-[10px]", CATEGORY_BADGE[item.category])}
          >
            {CATEGORY_LABEL[item.category]}
          </Badge>
        </div>
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          {item.isPacked ? "Packed" : "Not packed"}
        </p>
      </div>
      <IconButton title={`Delete ${item.label}`} disabled={busy} onClick={onDelete} />
    </li>
  );
}

function PackToggle({
  packed,
  busy,
  label,
  onClick,
}: {
  packed: boolean;
  busy: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      title={packed ? `Mark ${label} as not packed` : `Mark ${label} as packed`}
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-full border transition-colors",
        packed
          ? "border-[var(--accent-line)] bg-[var(--accent-line)] text-[var(--primary-foreground)]"
          : "border-[var(--border-hairline)] text-[var(--text-muted)] hover:bg-[var(--surface-sunken)]"
      )}
    >
      {busy ? (
        <Loader2 className="size-4 animate-spin" />
      ) : packed ? (
        <Check className="size-4" />
      ) : (
        <Circle className="size-4" />
      )}
    </button>
  );
}

function IconButton({
  title,
  disabled,
  onClick,
}: {
  title: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className="flex size-9 shrink-0 items-center justify-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--status-blocked-soft)] hover:text-[var(--status-blocked)] disabled:opacity-50"
    >
      <Trash2 className="size-4" />
    </button>
  );
}

function progress(packed: number, total: number): { packed: number; total: number; pct: number } {
  return {
    packed,
    total,
    pct: total > 0 ? Math.round((packed / total) * 100) : 0,
  };
}

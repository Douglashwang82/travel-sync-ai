"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { appFetch, appFetchJson } from "@/lib/app-client";
import {
  TabPageHeader,
  TabSurface,
  TabSurfaceTitle,
  TabError,
  TabSkeleton,
} from "@/components/app/tab-shell";
import type { AppExpensesResponse } from "@/lib/app-trip-expenses";

export function TripExpensesClient({
  tripId,
  initialData,
}: {
  tripId: string;
  initialData?: AppExpensesResponse;
}) {
  const [data, setData] = useState<AppExpensesResponse | null>(initialData ?? null);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await appFetchJson<AppExpensesResponse>(
        `/api/app/trips/${tripId}/expenses`
      );
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load expenses");
    }
  }, [tripId]);

  useEffect(() => {
    if (initialData) return;
    void load();
  }, [initialData, load]);

  async function handleSubmit() {
    const value = Number.parseFloat(amount);
    if (!Number.isFinite(value) || value <= 0) {
      setSubmitError("Enter a valid amount.");
      return;
    }
    if (!description.trim()) {
      setSubmitError("Enter a description.");
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    try {
      await appFetchJson(`/api/app/trips/${tripId}/expenses`, {
        method: "POST",
        body: JSON.stringify({ amount: value, description: description.trim() }),
      });
      setAmount("");
      setDescription("");
      setAddOpen(false);
      await load();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to record expense");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(expenseId: string) {
    if (!confirm("Delete this expense? Balances will update immediately.")) return;
    setDeleting(expenseId);
    try {
      const res = await appFetch(
        `/api/app/trips/${tripId}/expenses/${expenseId}`,
        { method: "DELETE" }
      );
      if (!res.ok && res.status !== 204) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Failed to delete expense");
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete expense");
    } finally {
      setDeleting(null);
    }
  }

  if (error) {
    return <TabError message={error} onRetry={() => void load()} />;
  }

  if (!data) {
    return <TabSkeleton />;
  }

  const currency = data.budgetCurrency;
  const perPerson =
    data.balances.length > 0 ? data.totalAmount / data.balances.length : 0;
  const budgetPct =
    data.budgetAmount && data.budgetAmount > 0
      ? Math.min(100, (data.totalAmount / data.budgetAmount) * 100)
      : null;

  return (
    <div className="space-y-6">
      <TabPageHeader
        title="Expenses"
        subtitle="Log shared costs, track balances, and settle up in the fewest transfers."
        actions={
          <Button size="sm" onClick={() => setAddOpen(true)}>
            + Log expense
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryCard
          label="Total spent"
          value={`${currency} ${Math.round(data.totalAmount).toLocaleString()}`}
          subtitle={
            data.balances.length > 0
              ? `~ ${currency} ${Math.round(perPerson).toLocaleString()} per person · ${data.balances.length} ${data.balances.length === 1 ? "person" : "people"}`
              : "No one splitting yet"
          }
          tone="primary"
        />
        <SummaryCard
          label="Budget"
          value={
            data.budgetAmount != null
              ? `${currency} ${data.budgetAmount.toLocaleString()}`
              : "Not set"
          }
          subtitle={
            budgetPct != null ? `${budgetPct.toFixed(0)}% used` : "Set via /budget in chat"
          }
          progress={budgetPct}
        />
        <SummaryCard
          label="Open settlements"
          value={`${data.settlements.length}`}
          subtitle={
            data.settlements.length > 0
              ? "Transfers to make everyone even"
              : "Everyone is settled"
          }
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <TabSurface className="lg:col-span-1">
          <TabSurfaceTitle
            title="Balances"
            subtitle="Green is owed money; red owes money."
          />
          <ul className="mt-3 space-y-2">
            {data.balances.length === 0 ? (
              <li className="text-xs italic text-[var(--text-muted)]">
                No expenses yet.
              </li>
            ) : (
              data.balances.map((b) => (
                <li
                  key={b.displayName}
                  className="flex items-center justify-between rounded-xl bg-[var(--surface-sunken)] px-3 py-2"
                >
                  <span className="truncate text-sm font-medium text-[var(--text-primary)]">
                    {b.displayName}
                  </span>
                  <span
                    className={cn(
                      "text-mono text-sm font-semibold",
                      b.net > 0.5
                        ? "text-[var(--status-settled)]"
                        : b.net < -0.5
                          ? "text-[var(--status-blocked)]"
                          : "text-[var(--text-muted)]"
                    )}
                  >
                    {b.net > 0 ? "+" : ""}
                    {currency} {Math.round(b.net).toLocaleString()}
                  </span>
                </li>
              ))
            )}
          </ul>

          {data.settlements.length > 0 && (
            <div className="mt-5 space-y-2 border-t border-[var(--border-hairline)] pt-4">
              <h4 className="text-caps">Settle up</h4>
              <ul className="space-y-2">
                {data.settlements.map((s, i) => (
                  <li
                    key={i}
                    className="flex items-center justify-between rounded-xl border border-[var(--border-hairline)] px-3 py-2 text-xs"
                  >
                    <span className="truncate text-[var(--text-primary)]">
                      <span className="font-medium">{s.from}</span>
                      <span className="text-[var(--text-muted)]"> → </span>
                      <span className="font-medium">{s.to}</span>
                    </span>
                    <span className="text-mono shrink-0 font-semibold text-[var(--status-blocked)]">
                      {currency} {Math.round(s.amount).toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </TabSurface>

        <TabSurface className="lg:col-span-2">
          <TabSurfaceTitle
            title="History"
            subtitle="Most recent first. Delete an expense if it was logged by mistake."
          />
          <ul className="mt-3 divide-y divide-[var(--border-hairline)]">
            {data.expenses.length === 0 ? (
              <li className="py-3 text-xs italic text-[var(--text-muted)]">
                Nothing logged yet.
              </li>
            ) : (
              data.expenses.map((e) => (
                <li
                  key={e.id}
                  className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-[var(--text-primary)]">
                      {e.description}
                    </p>
                    <p className="text-[11px] text-[var(--text-muted)]">
                      Paid by {e.paidByDisplayName ?? "Unknown"} ·{" "}
                      {new Date(e.createdAt).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                  <span className="text-mono text-sm font-semibold text-[var(--text-primary)]">
                    {currency} {Math.round(e.amount).toLocaleString()}
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleDelete(e.id)}
                    disabled={deleting === e.id}
                    className="text-xs text-[var(--text-muted)] transition-colors hover:text-[var(--status-blocked)] disabled:opacity-50"
                  >
                    {deleting === e.id ? "Deleting..." : "Delete"}
                  </button>
                </li>
              ))
            )}
          </ul>
        </TabSurface>
      </div>

      <Dialog
        open={addOpen}
        onOpenChange={(o) => {
          setAddOpen(o);
          if (!o) setSubmitError(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Log a shared expense</DialogTitle>
            <DialogDescription>
              The cost is split equally among all current trip members.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="expense-amount">Amount</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-medium text-[var(--text-muted)]">
                  {currency}
                </span>
                <Input
                  id="expense-amount"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  placeholder="0"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="pl-12"
                  autoFocus
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="expense-description">Description</Label>
              <Input
                id="expense-description"
                placeholder="e.g. Dinner at Nanbantei"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            {submitError && <p className="text-xs text-destructive">{submitError}</p>}
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" disabled={submitting}>
                Cancel
              </Button>
            </DialogClose>
            <Button onClick={() => void handleSubmit()} disabled={submitting}>
              {submitting ? "Saving..." : "Log expense"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  subtitle,
  tone,
  progress,
}: {
  label: string;
  value: string;
  subtitle?: string;
  tone?: "primary";
  progress?: number | null;
}) {
  const valueColor =
    tone === "primary" ? "text-[var(--accent-line)]" : "text-[var(--text-primary)]";
  return (
    <div className="surface-tile p-5">
      <p className="text-caps">{label}</p>
      <p className={cn("text-display mt-1 text-2xl", valueColor)}>{value}</p>
      {subtitle && (
        <p className="mt-1 text-xs text-[var(--text-muted)]">{subtitle}</p>
      )}
      {progress != null && (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--surface-sunken)]">
          <div
            className={cn(
              "h-full transition-all",
              progress >= 90
                ? "bg-[var(--status-blocked)]"
                : "bg-[var(--accent-line)]"
            )}
            style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
          />
        </div>
      )}
    </div>
  );
}

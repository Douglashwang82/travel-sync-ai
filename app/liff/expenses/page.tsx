"use client";

import { useEffect, useState, useCallback } from "react";
import { useLiff } from "@/components/liff-provider";
import {
  LoadingSpinner,
  ListSkeleton,
  ErrorScreen,
  EmptyState,
} from "@/components/liff/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { liffFetch } from "@/lib/liff-client";
import type { ExpensesResponse, ExpenseRow } from "@/app/api/liff/expenses/route";

type SessionData = {
  group: { id: string };
  member: { lineUserId: string };
  activeTrip: { id: string; destination_name: string } | null;
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ExpensesPage() {
  const { isReady, isLoggedIn, profile, lineGroupId, error } = useLiff();
  const [session, setSession] = useState<SessionData | null>(null);
  const [data, setData] = useState<ExpensesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Add expense sheet
  const [addOpen, setAddOpen] = useState(false);
  const [expAmount, setExpAmount] = useState("");
  const [expDesc, setExpDesc] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!profile || !lineGroupId) return;
    setLoading(true);
    setLoadError(null);
    try {
      // Resolve session
      const sessionRes = await liffFetch(
        `/api/liff/session?lineGroupId=${encodeURIComponent(lineGroupId)}&lineUserId=${encodeURIComponent(profile.userId)}&displayName=${encodeURIComponent(profile.displayName)}`
      );
      if (!sessionRes.ok) throw new Error("Failed to load session");
      const sess: SessionData = await sessionRes.json();
      setSession(sess);

      // Fetch expenses
      const params = new URLSearchParams({ groupId: sess.group.id });
      if (sess.activeTrip) params.set("tripId", sess.activeTrip.id);
      const res = await liffFetch(`/api/liff/expenses?${params}`);
      if (!res.ok) throw new Error("Failed to load expenses");
      setData(await res.json());
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [profile, lineGroupId]);

  useEffect(() => {
    if (isReady && isLoggedIn) load();
  }, [isReady, isLoggedIn, load]);

  async function handleAddExpense() {
    if (!session || !profile) return;
    const amount = parseFloat(expAmount);
    if (isNaN(amount) || amount <= 0) {
      setSubmitError("Enter a valid amount.");
      return;
    }
    if (!expDesc.trim()) {
      setSubmitError("Enter a description.");
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await liffFetch("/api/liff/expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          groupId: session.group.id,
          tripId: session.activeTrip?.id ?? null,
          displayName: profile.displayName,
          amount,
          description: expDesc.trim(),
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Failed to record expense");
      }
      setExpAmount("");
      setExpDesc("");
      setAddOpen(false);
      await load();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Error");
    } finally {
      setSubmitting(false);
    }
  }

  // ── Render states ─────────────────────────────────────────────────────────

  if (!isReady)    return <LoadingSpinner message="Initializing…" />;
  if (error)       return <ErrorScreen message={error} />;
  if (!isLoggedIn) return <LoadingSpinner message="Logging in…" />;
  if (loading)     return <ListSkeleton rows={4} />;
  if (loadError)   return <ErrorScreen message={loadError} onRetry={load} />;

  return (
    <div className="max-w-md mx-auto">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-[var(--background)]/95 backdrop-blur-sm border-b border-[var(--border)] px-4 py-3 flex items-center justify-between">
        <div>
          <h1 className="font-bold text-base">💰 Expenses</h1>
          {session?.activeTrip && (
            <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
              {session.activeTrip.destination_name}
            </p>
          )}
        </div>
        <Button size="sm" onClick={() => setAddOpen(true)}>
          + Add
        </Button>
      </div>

      {!data || data.expenses.length === 0 ? (
        <EmptyState
          emoji="💸"
          title="No expenses logged"
          description="Log shared costs as you go and track who owes whom."
          action={
            <Button size="sm" onClick={() => setAddOpen(true)}>
              Log first expense
            </Button>
          }
        />
      ) : (
        <div className="px-4 pt-4 space-y-4 pb-4">
          {/* Total card */}
          <TotalCard totalAmount={data.totalAmount} memberCount={data.balances.length} />

          {/* Settlements */}
          {data.settlements.length > 0 && (
            <section>
              <SectionHeader title="Settle up" />
              <div className="rounded-2xl border border-[var(--border)] divide-y divide-[var(--border)] overflow-hidden">
                {data.settlements.map((s, i) => (
                  <SettlementRow key={i} settlement={s} />
                ))}
              </div>
            </section>
          )}

          {/* Balances */}
          {data.balances.length > 0 && (
            <section>
              <SectionHeader title="Balances" />
              <div className="rounded-2xl border border-[var(--border)] divide-y divide-[var(--border)] overflow-hidden">
                {data.balances.map((b, i) => (
                  <BalanceRow key={i} balance={b} />
                ))}
              </div>
            </section>
          )}

          {/* Expense history */}
          <section>
            <SectionHeader title="History" />
            <div className="rounded-2xl border border-[var(--border)] divide-y divide-[var(--border)] overflow-hidden">
              {data.expenses.map((exp) => (
                <ExpenseRowItem key={exp.id} expense={exp} />
              ))}
            </div>
          </section>
        </div>
      )}

      {/* Add expense sheet */}
      <Sheet open={addOpen} onOpenChange={(open) => { setAddOpen(open); if (!open) setSubmitError(null); }}>
        <SheetContent side="bottom" className="rounded-t-2xl">
          <SheetHeader className="mb-4">
            <SheetTitle>Log an expense</SheetTitle>
          </SheetHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="exp-amount">Amount</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[var(--muted-foreground)]">
                  ¥
                </span>
                <Input
                  id="exp-amount"
                  type="number"
                  inputMode="decimal"
                  placeholder="0"
                  className="pl-7"
                  value={expAmount}
                  onChange={(e) => setExpAmount(e.target.value)}
                  autoFocus
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="exp-desc">Description</Label>
              <Input
                id="exp-desc"
                placeholder="e.g. Dinner at Nanbantei"
                value={expDesc}
                onChange={(e) => setExpDesc(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAddExpense()}
              />
            </div>
            {submitError && (
              <p className="text-xs text-[var(--destructive)]">{submitError}</p>
            )}
            <p className="text-xs text-[var(--muted-foreground)]">
              Split equally among all group members.
            </p>
            <Button
              className="w-full"
              onClick={handleAddExpense}
              disabled={submitting || !expAmount || !expDesc.trim()}
            >
              {submitting ? "Saving..." : "Log expense"}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function TotalCard({ totalAmount, memberCount }: { totalAmount: number; memberCount: number }) {
  return (
    <div className="rounded-2xl bg-[var(--primary)] text-white p-5">
      <p className="text-xs font-medium opacity-80">Total trip expenses</p>
      <p className="text-3xl font-bold mt-1">¥{totalAmount.toLocaleString()}</p>
      {memberCount > 0 && (
        <p className="text-xs opacity-70 mt-1">
          ≈ ¥{Math.round(totalAmount / memberCount).toLocaleString()} per person
          &nbsp;·&nbsp; {memberCount} members
        </p>
      )}
    </div>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <h2 className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wide mb-2 px-1">
      {title}
    </h2>
  );
}

function SettlementRow({
  settlement,
}: {
  settlement: { from: string; to: string; amount: number };
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{settlement.from}</p>
        <p className="text-xs text-[var(--muted-foreground)]">
          owes {settlement.to}
        </p>
      </div>
      <span className="text-sm font-bold text-red-500 shrink-0">
        ¥{settlement.amount.toLocaleString()}
      </span>
    </div>
  );
}

function BalanceRow({ balance }: { balance: { displayName: string; net: number } }) {
  const isPositive = balance.net > 0;
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <p className="text-sm font-medium">{balance.displayName}</p>
      <span
        className={cn(
          "text-sm font-semibold",
          isPositive ? "text-[var(--primary)]" : "text-red-500"
        )}
      >
        {isPositive ? "+" : ""}¥{balance.net.toLocaleString()}
      </span>
    </div>
  );
}

function ExpenseRowItem({ expense }: { expense: ExpenseRow }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{expense.description}</p>
        <p className="text-xs text-[var(--muted-foreground)]">
          Paid by {expense.paid_by_display_name ?? "Unknown"} ·{" "}
          {new Date(expense.created_at).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
          })}
        </p>
      </div>
      <span className="text-sm font-semibold shrink-0">
        ¥{Number(expense.amount).toLocaleString()}
      </span>
    </div>
  );
}


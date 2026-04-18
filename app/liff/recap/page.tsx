"use client";

import { useCallback, useEffect, useState } from "react";
import { EmptyState, ErrorScreen, ListSkeleton, LoadingSpinner } from "@/components/liff/shared";
import { Badge } from "@/components/ui/badge";
import { liffFetch } from "@/lib/liff-client";
import { toLiffErrorMessage } from "@/lib/liff-errors";
import { useLiffSession } from "@/lib/use-liff-session";

type ConfirmedItem = {
  id: string;
  title: string;
  itemType: string;
  bookingRef: string | null;
  scheduledAt: string | null;
  option: { name: string | null; address: string | null } | null;
};

type Expense = {
  id: string;
  description: string | null;
  amount: number;
  paidBy: string | null;
  createdAt: string;
};

type RecapData = {
  trip: {
    id: string;
    destinationName: string;
    startDate: string | null;
    endDate: string | null;
    endedAt: string | null;
    budgetAmount: number | null;
    budgetCurrency: string;
  };
  confirmedItems: ConfirmedItem[];
  expenses: Expense[];
  totalSpent: number;
  memberCount: number;
};

const ITEM_TYPE_ICON: Record<string, string> = {
  flight: "✈️",
  hotel: "🏨",
  restaurant: "🍽️",
  activity: "🎯",
  transport: "🚌",
  insurance: "🛡️",
  other: "📌",
};

function formatDate(value: string | null): string {
  if (!value) return "";
  return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function RecapPage() {
  const { isReady, isLoggedIn, error, session, sessionLoading, sessionError, reloadSession } =
    useLiffSession();
  const [data, setData] = useState<RecapData | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const s = await reloadSession();
      if (!s) throw new Error("No session");
      const res = await liffFetch(
        `/api/liff/recap?lineGroupId=${encodeURIComponent(s.group.lineGroupId)}`
      );
      if (!res.ok) throw new Error("Failed to load recap");
      setData(await res.json());
    } catch (err) {
      setLoadError(toLiffErrorMessage("recap", err, "Could not load trip recap."));
    } finally {
      setLoading(false);
    }
  }, [reloadSession]);

  useEffect(() => {
    if (!isReady || !isLoggedIn || !session || sessionLoading) return;
    void (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const res = await liffFetch(
          `/api/liff/recap?lineGroupId=${encodeURIComponent(session.group.lineGroupId)}`
        );
        if (!res.ok) throw new Error("Failed to load recap");
        setData(await res.json());
      } catch (err) {
        setLoadError(toLiffErrorMessage("recap", err, "Could not load trip recap."));
      } finally {
        setLoading(false);
      }
    })();
  }, [isReady, isLoggedIn, session, sessionLoading]);

  if (!isReady) return <LoadingSpinner message="Initializing..." />;
  if (error) return <ErrorScreen message={error} />;
  if (!isLoggedIn) return <LoadingSpinner message="Logging in..." />;
  if (sessionLoading && !session) return <ListSkeleton rows={4} />;
  if (sessionError && !session) return <ErrorScreen message={sessionError} onRetry={load} />;
  if (loading) return <ListSkeleton rows={4} />;
  if (loadError) return <ErrorScreen message={loadError} onRetry={load} />;

  if (!data) {
    return (
      <EmptyState
        emoji="🏁"
        title="No completed trips yet"
        description="Complete your first trip to see the recap."
      />
    );
  }

  const { trip, confirmedItems, expenses, totalSpent } = data;
  const overBudget =
    trip.budgetAmount != null && totalSpent > trip.budgetAmount
      ? totalSpent - trip.budgetAmount
      : null;
  const underBudget =
    trip.budgetAmount != null && totalSpent <= trip.budgetAmount
      ? trip.budgetAmount - totalSpent
      : null;

  return (
    <div className="mx-auto max-w-md">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-[var(--border)] bg-[var(--primary)] px-4 py-3 text-white">
        <p className="text-xs font-medium uppercase tracking-widest opacity-80">Post-trip Recap</p>
        <h1 className="mt-1 text-base font-bold">{trip.destinationName}</h1>
        {trip.startDate && trip.endDate && (
          <p className="mt-0.5 text-xs opacity-75">
            {trip.startDate} – {trip.endDate}
          </p>
        )}
      </div>

      <div className="space-y-5 px-4 pb-6 pt-4">
        {/* Stats */}
        <section className="grid grid-cols-3 gap-3">
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-3 text-center">
            <p className="text-2xl font-bold">{confirmedItems.length}</p>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">Confirmed items</p>
          </div>
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-3 text-center">
            <p className="text-2xl font-bold">{expenses.length}</p>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">Expenses</p>
          </div>
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-3 text-center">
            <p className="text-2xl font-bold">{data.memberCount}</p>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">Travelers</p>
          </div>
        </section>

        {/* Budget */}
        {trip.budgetAmount != null && (
          <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
            <h2 className="text-sm font-semibold">Budget</h2>
            <div className="mt-3 space-y-1">
              <div className="flex justify-between text-sm">
                <span>Total spent</span>
                <span className="font-medium">
                  {totalSpent.toLocaleString()} {trip.budgetCurrency}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span>Budget</span>
                <span className="font-medium">
                  {trip.budgetAmount.toLocaleString()} {trip.budgetCurrency}
                </span>
              </div>
              {overBudget != null && (
                <div className="flex justify-between text-sm text-red-600">
                  <span>Over budget</span>
                  <span className="font-medium">
                    +{overBudget.toLocaleString()} {trip.budgetCurrency}
                  </span>
                </div>
              )}
              {underBudget != null && underBudget > 0 && (
                <div className="flex justify-between text-sm text-green-600">
                  <span>Under budget</span>
                  <span className="font-medium">
                    -{underBudget.toLocaleString()} {trip.budgetCurrency}
                  </span>
                </div>
              )}
            </div>
            {trip.budgetAmount != null && (
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--secondary)]">
                <div
                  className={`h-full rounded-full ${overBudget != null ? "bg-red-500" : "bg-[var(--primary)]"}`}
                  style={{
                    width: `${Math.min(100, Math.round((totalSpent / trip.budgetAmount) * 100))}%`,
                  }}
                />
              </div>
            )}
          </section>
        )}

        {/* Trip timeline */}
        <section>
          <h2 className="mb-2 text-sm font-semibold">Trip Timeline</h2>
          {confirmedItems.length === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)]">No confirmed items recorded.</p>
          ) : (
            <div className="space-y-2">
              {confirmedItems.map((item) => {
                const icon = ITEM_TYPE_ICON[item.itemType] ?? "📌";
                const name = item.option?.name ?? item.title;
                return (
                  <div
                    key={item.id}
                    className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">
                          {icon} {name}
                        </p>
                        {item.option?.address && (
                          <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
                            📍 {item.option.address}
                          </p>
                        )}
                      </div>
                      <div className="shrink-0 flex flex-col items-end gap-1">
                        {item.scheduledAt && (
                          <Badge variant="outline" className="text-[10px]">
                            {formatDate(item.scheduledAt)}
                          </Badge>
                        )}
                        {item.bookingRef && (
                          <Badge variant="secondary" className="text-[10px]">
                            {item.bookingRef}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Expenses */}
        {expenses.length > 0 && (
          <section>
            <h2 className="mb-2 text-sm font-semibold">Expenses</h2>
            <div className="divide-y divide-[var(--border)] overflow-hidden rounded-xl border border-[var(--border)]">
              {expenses.map((e) => (
                <div key={e.id} className="flex items-center justify-between px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm">{e.description ?? "Expense"}</p>
                    {e.paidBy && (
                      <p className="text-xs text-[var(--muted-foreground)]">Paid by {e.paidBy}</p>
                    )}
                  </div>
                  <p className="ml-3 shrink-0 text-sm font-medium">
                    ${e.amount.toLocaleString()}
                  </p>
                </div>
              ))}
              <div className="flex items-center justify-between bg-[var(--secondary)] px-4 py-3">
                <p className="text-sm font-semibold">Total</p>
                <p className="text-sm font-bold">${totalSpent.toLocaleString()}</p>
              </div>
            </div>
          </section>
        )}

        {/* Memories CTA */}
        <section className="rounded-2xl border border-[var(--border)] bg-[var(--secondary)] p-4 text-center">
          <p className="text-2xl">🎉</p>
          <p className="mt-2 text-sm font-semibold">Thanks for traveling together!</p>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            Use <span className="font-mono">/start</span> in the group chat to plan your next
            adventure.
          </p>
        </section>
      </div>
    </div>
  );
}

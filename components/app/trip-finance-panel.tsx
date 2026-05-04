"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import type { AppExpensesResponse } from "@/lib/app-trip-expenses";

export function TripFinancePanel({
  tripId,
  expenses,
  memberCount,
}: {
  tripId: string;
  expenses: AppExpensesResponse;
  memberCount: number;
}) {
  const total = expenses.totalAmount;
  const perPerson = memberCount > 0 ? total / memberCount : total;
  const budget = expenses.budgetAmount;
  const budgetPerPerson =
    budget != null && memberCount > 0
      ? budget / memberCount
      : budget;
  const budgetPct =
    budget != null && budget > 0
      ? Math.min(100, (total / budget) * 100)
      : null;
  const overBudget = budget != null && total > budget;

  const unsettled = expenses.settlements.reduce(
    (sum, s) => sum + s.amount,
    0
  );

  return (
    <section className="rounded-3xl border border-[var(--border)] bg-[var(--background)] p-5">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">Trip finance</h2>
          <p className="text-[11px] text-[var(--muted-foreground)]">
            Live snapshot. Settle balances anytime.
          </p>
        </div>
        <Link
          href={`/app/trips/${tripId}/expenses`}
          className="text-xs font-medium text-[var(--primary)] hover:underline"
        >
          Manage →
        </Link>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <Stat
          label="Total"
          value={formatMoney(total, expenses.budgetCurrency)}
        />
        <Stat
          label="Per person"
          value={formatMoney(perPerson, expenses.budgetCurrency)}
        />
        <Stat
          label="Unsettled"
          value={formatMoney(unsettled, expenses.budgetCurrency)}
          tone={unsettled > 0 ? "amber" : "muted"}
        />
      </div>

      {budget != null && (
        <div className="mt-4 space-y-1.5">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-[var(--muted-foreground)]">
              Budget · {formatMoney(budgetPerPerson ?? budget, expenses.budgetCurrency)} / person
            </span>
            <span
              className={cn(
                "font-semibold",
                overBudget
                  ? "text-red-600 dark:text-red-400"
                  : "text-emerald-700 dark:text-emerald-300"
              )}
            >
              {overBudget ? "Over budget" : "Under budget"}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-[var(--secondary)]">
            <div
              className={cn(
                "h-full transition-all",
                overBudget ? "bg-red-500" : "bg-emerald-500"
              )}
              style={{ width: `${budgetPct ?? 0}%` }}
            />
          </div>
        </div>
      )}

      {expenses.settlements.length > 0 ? (
        <div className="mt-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
            Who owes whom
          </p>
          <ul className="mt-2 space-y-1">
            {expenses.settlements.slice(0, 4).map((s, i) => (
              <li
                key={i}
                className="flex items-center justify-between gap-2 rounded-lg bg-[var(--secondary)]/60 px-2.5 py-1.5 text-xs"
              >
                <span className="truncate">
                  <span className="font-medium">{s.from}</span>
                  <span className="mx-1 text-[var(--muted-foreground)]">→</span>
                  <span className="font-medium">{s.to}</span>
                </span>
                <span className="font-semibold text-red-600 dark:text-red-400">
                  {formatMoney(s.amount, expenses.budgetCurrency)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="mt-4 rounded-xl border border-dashed border-[var(--border)] px-3 py-3 text-center text-[11px] italic text-[var(--muted-foreground)]">
          Everyone&apos;s settled.
        </p>
      )}
    </section>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "amber" | "muted";
}) {
  const toneClass =
    tone === "amber"
      ? "text-amber-700 dark:text-amber-300"
      : "text-[var(--foreground)]";
  return (
    <div className="rounded-xl bg-[var(--secondary)]/60 px-2.5 py-2">
      <p className={cn("truncate text-base font-bold", toneClass)}>{value}</p>
      <p className="mt-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
        {label}
      </p>
    </div>
  );
}

function formatMoney(amount: number, currency: string): string {
  const rounded = Math.round(amount);
  return `${currency} ${rounded.toLocaleString()}`;
}

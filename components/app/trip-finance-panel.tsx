"use client";

import Link from "next/link";
import { useAppLocale } from "@/components/app/app-locale-provider";
import { cn } from "@/lib/utils";
import { IconArrowUpRight, IconCoin } from "@/components/app/icons";
import type { AppExpensesResponse } from "@/lib/app-trip-expenses";

const COPY = {
  en: { title: "Trip finance", sub: "Live snapshot. Settle anytime.", manage: "Manage", total: "Total", perPerson: "Per person", unsettled: "Unsettled", overBudget: "Over budget", onTrack: "On track", settled: "Everyone's settled.", whoOwes: "Who owes whom", settle: "Mark settled", noBudget: "No budget set", used: "used", spent: "spent" },
  "zh-TW": { title: "費用總覽", sub: "即時快照，隨時可結算。", manage: "管理", total: "總額", perPerson: "每人", unsettled: "未結算", overBudget: "超支", onTrack: "預算內", settled: "大家都已結清。", whoOwes: "誰欠誰", settle: "標記已結算", noBudget: "尚未設定預算", used: "已使用", spent: "已花費" },
} as const;

interface FinanceTileProps {
  tripId: string;
  expenses: AppExpensesResponse;
  memberCount: number;
  onSettleClick?: () => void;
}

export function FinanceTile({ tripId, expenses, memberCount, onSettleClick }: FinanceTileProps) {
  const { locale } = useAppLocale();
  const copy = COPY[locale];
  const { totalAmount, budgetAmount, budgetCurrency, settlements } = expenses;
  const perPerson = memberCount > 0 ? totalAmount / memberCount : totalAmount;
  const budgetPct =
    budgetAmount != null && budgetAmount > 0
      ? Math.min(120, (totalAmount / budgetAmount) * 100)
      : null;
  const overBudget = budgetAmount != null && totalAmount > budgetAmount;
  const unsettled = settlements.reduce((sum, s) => sum + s.amount, 0);

  return (
    <section className="surface-tile flex h-full flex-col p-6">
      <header className="flex items-baseline justify-between gap-3">
        <div>
          <h2 className="text-display text-2xl text-[var(--text-primary)]">{copy.title}</h2>
          <p className="mt-1 text-xs text-[var(--text-muted)]">{copy.sub}</p>
        </div>
        <Link
          href={`/app/trips/${tripId}/expenses`}
          className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--accent-line)] hover:underline"
        >
          {copy.manage}
          <IconArrowUpRight size={12} />
        </Link>
      </header>

      <div className="mt-6 flex items-center gap-5">
        <BudgetRing pct={budgetPct} overBudget={overBudget} />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-mono text-3xl font-semibold text-[var(--text-primary)]">
            {formatMoney(totalAmount, budgetCurrency)}
          </p>
          <p className="text-xs text-[var(--text-muted)]">
            {budgetAmount != null ? (
              <>
                {copy.perPerson} <span className="text-mono">{formatMoney(perPerson, budgetCurrency)}</span>
                <span className="mx-1.5 text-[var(--border-strong)]">·</span>
                <span className={overBudget ? "text-[var(--status-blocked)]" : "text-[var(--status-settled)]"}>
                  {overBudget ? copy.overBudget : copy.onTrack}
                </span>
              </>
            ) : (
              copy.noBudget
            )}
          </p>
        </div>
      </div>

      <output className="sr-only">
        {budgetAmount != null
          ? `${copy.used} ${Math.round(budgetPct ?? 0)}% / ${formatMoney(budgetAmount, budgetCurrency)}`
          : `${formatMoney(totalAmount, budgetCurrency)} ${copy.spent}`}
      </output>

      {settlements.length > 0 ? (
        <div className="mt-6 flex-1">
          <p className="text-caps">{copy.whoOwes}</p>
          <ul className="mt-3 space-y-1.5">
            {settlements.slice(0, 4).map((s, i) => (
              <li
                key={i}
                className="flex items-center justify-between gap-2 rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-raised)] px-3 py-2 text-xs"
              >
                <span className="min-w-0 truncate">
                  <span className="font-medium text-[var(--text-primary)]">{s.from}</span>
                  <span className="mx-1.5 text-[var(--text-faint)]">→</span>
                  <span className="font-medium text-[var(--text-primary)]">{s.to}</span>
                </span>
                <span className="text-mono font-semibold text-[var(--status-blocked)]">
                  {formatMoney(s.amount, budgetCurrency)}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex justify-end">
            <button type="button" onClick={onSettleClick} className="btn-tactile">
              <IconCoin size={14} />
              {copy.settle}
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-6 flex-1 rounded-xl border border-dashed border-[var(--border-hairline)] bg-[var(--surface-sunken)]/40 p-5 text-center">
          <p className="text-mono text-2xl font-semibold text-[var(--status-settled)]">
            {formatMoney(unsettled, budgetCurrency)}
          </p>
          <p className="mt-1 text-xs text-[var(--text-muted)]">{copy.settled}</p>
        </div>
      )}
    </section>
  );
}

function BudgetRing({ pct, overBudget }: { pct: number | null; overBudget: boolean }) {
  const value = pct ?? 0;
  const c = 2 * Math.PI * 36;
  const offset = c - (Math.min(100, value) / 100) * c;
  const ringColor = overBudget
    ? "stroke-[var(--status-blocked)]"
    : value > 80
      ? "stroke-[var(--status-needs-decision)]"
      : "stroke-[var(--accent-line)]";
  return (
    <div className="relative h-20 w-20 shrink-0">
      <svg viewBox="0 0 80 80" className="h-full w-full -rotate-90">
        <circle
          cx="40"
          cy="40"
          r="36"
          className="fill-none stroke-[var(--surface-sunken)]"
          strokeWidth="6"
        />
        <circle
          cx="40"
          cy="40"
          r="36"
          className={cn("fill-none transition-[stroke-dashoffset] duration-700 ease-[cubic-bezier(0.32,0.72,0,1)]", ringColor)}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={pct == null ? c : offset}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-mono text-sm font-semibold text-[var(--text-primary)]">
        {pct == null ? "-" : `${Math.round(value)}%`}
      </span>
    </div>
  );
}

function formatMoney(amount: number, currency: string): string {
  return `${currency} ${Math.round(amount).toLocaleString()}`;
}

// Backwards-compat alias.
export const TripFinancePanel = FinanceTile;

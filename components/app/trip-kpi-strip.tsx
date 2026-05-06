"use client";

import { cn } from "@/lib/utils";

export interface KpiTileSpec {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "primary" | "amber" | "emerald" | "red";
  icon?: string;
  href?: string;
  onClick?: () => void;
}

export function TripKpiStrip({ tiles }: { tiles: KpiTileSpec[] }) {
  return (
    <section className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      {tiles.map((t, i) => (
        <KpiTile key={i} {...t} />
      ))}
    </section>
  );
}

function KpiTile({
  label,
  value,
  hint,
  tone = "default",
  icon,
  href,
  onClick,
}: KpiTileSpec) {
  const interactive = !!href || !!onClick;
  const Comp = href ? "a" : onClick ? "button" : "div";
  const toneClass =
    tone === "primary"
      ? "border-[var(--primary)]/30 bg-[var(--primary)]/5"
      : tone === "amber"
        ? "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30"
        : tone === "emerald"
          ? "border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30"
          : tone === "red"
            ? "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/30"
            : "border-[var(--border)] bg-[var(--background)]";
  const valueClass =
    tone === "primary"
      ? "text-[var(--primary)]"
      : tone === "amber"
        ? "text-amber-700 dark:text-amber-300"
        : tone === "emerald"
          ? "text-emerald-700 dark:text-emerald-300"
          : tone === "red"
            ? "text-red-700 dark:text-red-300"
            : "text-[var(--foreground)]";

  return (
    <Comp
      href={href}
      onClick={onClick}
      type={Comp === "button" ? "button" : undefined}
      className={cn(
        "flex flex-col justify-between rounded-2xl border px-3 py-2.5 text-left transition-colors",
        toneClass,
        interactive && "cursor-pointer hover:shadow-sm"
      )}
    >
      <div className="flex items-center justify-between gap-1">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
          {label}
        </span>
        {icon && (
          <span aria-hidden className="text-sm">
            {icon}
          </span>
        )}
      </div>
      <div className="mt-1 space-y-0.5">
        <p
          className={cn(
            "text-xl font-bold leading-none tabular-nums sm:text-2xl",
            valueClass
          )}
        >
          {value}
        </p>
        {hint && (
          <p className="truncate text-[10px] text-[var(--muted-foreground)]">
            {hint}
          </p>
        )}
      </div>
    </Comp>
  );
}

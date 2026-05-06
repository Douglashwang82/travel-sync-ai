"use client";

import { useAppLocale } from "@/components/app/app-locale-provider";
import type { AppLocale } from "@/lib/app-locale";

const COPY: Record<
  AppLocale,
  {
    label: string;
    english: string;
    traditionalChinese: string;
  }
> = {
  en: {
    label: "Language",
    english: "EN",
    traditionalChinese: "繁中",
  },
  "zh-TW": {
    label: "語言",
    english: "EN",
    traditionalChinese: "繁中",
  },
};

export function AppLanguageToggle() {
  const { locale, setLocale } = useAppLocale();
  const copy = COPY[locale];

  return (
    <div
      className="flex items-center rounded-full border border-[var(--border)] bg-[var(--background)] p-1"
      aria-label={copy.label}
      role="group"
    >
      <ToggleButton active={locale === "en"} label={copy.english} onClick={() => setLocale("en")} />
      <ToggleButton
        active={locale === "zh-TW"}
        label={copy.traditionalChinese}
        onClick={() => setLocale("zh-TW")}
      />
    </div>
  );
}

function ToggleButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
        active
          ? "bg-[var(--primary)] text-white"
          : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
      }`}
    >
      {label}
    </button>
  );
}
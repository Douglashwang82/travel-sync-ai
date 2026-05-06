"use client";

import { createContext, startTransition, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { APP_LOCALE_COOKIE, type AppLocale } from "@/lib/app-locale";

const ONE_YEAR_IN_SECONDS = 60 * 60 * 24 * 365;

const AppLocaleContext = createContext<{
  locale: AppLocale;
  setLocale: (locale: AppLocale) => void;
} | null>(null);

export function AppLocaleProvider({
  initialLocale,
  children,
}: {
  initialLocale: AppLocale;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [locale, setLocaleState] = useState<AppLocale>(initialLocale);

  useEffect(() => {
    setLocaleState(initialLocale);
  }, [initialLocale]);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  function setLocale(nextLocale: AppLocale) {
    if (nextLocale === locale) return;
    setLocaleState(nextLocale);
    document.cookie = `${APP_LOCALE_COOKIE}=${encodeURIComponent(nextLocale)}; Path=/; Max-Age=${ONE_YEAR_IN_SECONDS}; SameSite=Lax`;
    startTransition(() => {
      router.refresh();
    });
  }

  return <AppLocaleContext.Provider value={{ locale, setLocale }}>{children}</AppLocaleContext.Provider>;
}

export function useAppLocale() {
  const context = useContext(AppLocaleContext);
  if (!context) {
    throw new Error("useAppLocale must be used within AppLocaleProvider");
  }
  return context;
}
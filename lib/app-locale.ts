export type AppLocale = "en" | "zh-TW";

export const APP_LOCALE_COOKIE = "travelsync-app-locale";
export const DEFAULT_APP_LOCALE: AppLocale = "en";

export function parseAppLocale(value: string | null | undefined): AppLocale {
  return value === "zh-TW" ? "zh-TW" : DEFAULT_APP_LOCALE;
}

export function getIntlLocale(locale: AppLocale): string {
  return locale === "zh-TW" ? "zh-TW" : "en-US";
}
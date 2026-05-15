/**
 * Public-holidays lookup backed by Nager.Date with a Supabase row cache.
 *
 *  - Cache hit (rows exist for (country, year) and `fetched_at` is within TTL)
 *    → return from DB.
 *  - Cache miss / stale → fetch from Nager, upsert, return.
 *  - Network failure → fall back to whatever's cached regardless of age.
 *
 * Country code is ISO-3166-1 alpha-2 (e.g. 'TW', 'JP'). Names are pulled from
 * Nager's `localName` so they render in the destination's language.
 */
import { createAdminClient } from "@/lib/db";

const NAGER_BASE = "https://date.nager.at/api/v3";
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface Holiday {
  country: string;
  date: string; // YYYY-MM-DD
  name: string;
  global: boolean;
}

export interface NagerCountry {
  countryCode: string;
  name: string;
}

interface NagerHoliday {
  date: string;
  localName: string;
  name: string;
  countryCode: string;
  global: boolean;
}

/**
 * Fetch holidays for a country + year, hitting the cache first.
 * Returns [] on hard failure with empty cache rather than throwing — calendar
 * tiles should keep rendering even if Nager is down.
 */
export async function getHolidays(
  country: string,
  year: number
): Promise<Holiday[]> {
  const db = createAdminClient();

  const { data: cached } = await db
    .from("national_holidays_cache")
    .select("date, name, global, fetched_at")
    .eq("country_code", country)
    .eq("year", year);

  const fresh =
    cached && cached.length > 0
      ? Date.now() - new Date(cached[0]!.fetched_at as string).getTime() <
        CACHE_TTL_MS
      : false;

  if (fresh) {
    return (cached ?? []).map((row) => ({
      country,
      date: row.date as string,
      name: row.name as string,
      global: Boolean(row.global),
    }));
  }

  try {
    const res = await fetch(
      `${NAGER_BASE}/PublicHolidays/${year}/${encodeURIComponent(country)}`,
      { cache: "no-store" }
    );
    if (!res.ok) throw new Error(`Nager returned ${res.status}`);
    const payload = (await res.json()) as NagerHoliday[];

    // Replace cache rows for (country, year). Delete-then-insert keeps things
    // simple — there are at most ~20 rows per (country, year).
    await db
      .from("national_holidays_cache")
      .delete()
      .eq("country_code", country)
      .eq("year", year);

    if (payload.length > 0) {
      await db.from("national_holidays_cache").insert(
        payload.map((h) => ({
          country_code: country,
          year,
          date: h.date,
          name: h.localName || h.name,
          global: h.global,
        }))
      );
    }

    return payload.map((h) => ({
      country,
      date: h.date,
      name: h.localName || h.name,
      global: h.global,
    }));
  } catch {
    // Fall back to stale cache if we have any.
    return (cached ?? []).map((row) => ({
      country,
      date: row.date as string,
      name: row.name as string,
      global: Boolean(row.global),
    }));
  }
}

/**
 * Get holidays for several countries and a date range. Years are derived from
 * the range and fetched in parallel, then filtered to dates strictly inside
 * [from, to] inclusive.
 */
export async function getHolidaysInRange(
  countries: string[],
  from: string,
  to: string
): Promise<Holiday[]> {
  if (countries.length === 0) return [];
  const startYear = Number(from.slice(0, 4));
  const endYear = Number(to.slice(0, 4));
  const years: number[] = [];
  for (let y = startYear; y <= endYear; y++) years.push(y);

  const fetches: Array<Promise<Holiday[]>> = [];
  for (const country of countries) {
    for (const year of years) {
      fetches.push(getHolidays(country, year));
    }
  }
  const results = await Promise.all(fetches);
  const flat = results.flat();
  return flat.filter((h) => h.date >= from && h.date <= to);
}

/**
 * Available countries from Nager. Cached in memory for the lifetime of the
 * serverless instance; the list barely changes.
 */
let availableCountriesCache: NagerCountry[] | null = null;
let availableCountriesFetchedAt = 0;

export async function getAvailableCountries(): Promise<NagerCountry[]> {
  if (
    availableCountriesCache &&
    Date.now() - availableCountriesFetchedAt < CACHE_TTL_MS
  ) {
    return availableCountriesCache;
  }
  try {
    const res = await fetch(`${NAGER_BASE}/AvailableCountries`, {
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Nager returned ${res.status}`);
    const list = (await res.json()) as NagerCountry[];
    availableCountriesCache = list;
    availableCountriesFetchedAt = Date.now();
    return list;
  } catch {
    return availableCountriesCache ?? [];
  }
}

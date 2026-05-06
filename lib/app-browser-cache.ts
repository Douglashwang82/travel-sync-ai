"use client";

const APP_CACHE_PREFIX = "travelsync:app-cache";
const APP_CACHE_SCOPE_KEY = `${APP_CACHE_PREFIX}:scope`;

type CacheEnvelope<T> = {
  savedAt: number;
  value: T;
};

function getSessionStorage(): Storage | null {
  if (typeof window === "undefined") return null;

  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function getScope(storage: Storage): string {
  const existing = storage.getItem(APP_CACHE_SCOPE_KEY);
  if (existing) return existing;

  const nextScope =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  storage.setItem(APP_CACHE_SCOPE_KEY, nextScope);
  return nextScope;
}

function buildCacheKey(storage: Storage, bucket: string, key: string): string {
  return `${APP_CACHE_PREFIX}:${getScope(storage)}:${bucket}:${key}`;
}

export function readAppBrowserCache<T>(
  bucket: string,
  key: string,
  maxAgeMs: number
): T | null {
  const storage = getSessionStorage();
  if (!storage) return null;

  const raw = storage.getItem(buildCacheKey(storage, bucket, key));
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as CacheEnvelope<T>;
    if (Date.now() - parsed.savedAt > maxAgeMs) {
      storage.removeItem(buildCacheKey(storage, bucket, key));
      return null;
    }

    return parsed.value;
  } catch {
    storage.removeItem(buildCacheKey(storage, bucket, key));
    return null;
  }
}

export function writeAppBrowserCache<T>(bucket: string, key: string, value: T): void {
  const storage = getSessionStorage();
  if (!storage) return;

  const envelope: CacheEnvelope<T> = {
    savedAt: Date.now(),
    value,
  };

  try {
    storage.setItem(buildCacheKey(storage, bucket, key), JSON.stringify(envelope));
  } catch {
    // Ignore quota and serialization failures; the network path still works.
  }
}

export function clearAppBrowserCache(): void {
  const storage = getSessionStorage();
  if (!storage) return;

  const keysToRemove: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(APP_CACHE_PREFIX)) {
      keysToRemove.push(key);
    }
  }

  for (const key of keysToRemove) {
    storage.removeItem(key);
  }
}
const STORAGE_KEY = "liff:lineGroupId";

/**
 * Persist a LINE group ID in sessionStorage before the LIFF OAuth redirect.
 * liff.getContext() can lose the group context after the login round-trip,
 * so we stash it here and restore it on the way back.
 */
export function stashLineGroupId(groupId: string): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, groupId);
  } catch {
    // sessionStorage unavailable (e.g. private mode quota, SSR) — safe to ignore
  }
}

/**
 * Restore and clear the stashed group ID. Returns null if nothing was stashed.
 */
export function popLineGroupId(): string | null {
  try {
    const value = sessionStorage.getItem(STORAGE_KEY);
    if (value) sessionStorage.removeItem(STORAGE_KEY);
    return value;
  } catch {
    return null;
  }
}

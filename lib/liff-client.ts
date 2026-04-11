"use client";

import { getLiffE2EContext } from "@/lib/liff-e2e";

export async function getLiffIdToken(): Promise<string | null> {
  const e2eContext = getLiffE2EContext();
  if (e2eContext?.idToken) {
    return e2eContext.idToken;
  }

  try {
    const liff = (await import("@line/liff")).default;
    return liff.getIDToken();
  } catch {
    return null;
  }
}

export async function liffFetch(
  input: RequestInfo | URL,
  init: RequestInit = {}
): Promise<Response> {
  const idToken = await getLiffIdToken();
  const headers = new Headers(init.headers);

  if (!idToken) {
    throw new Error("Not authenticated. Please reopen in LINE.");
  }

  headers.set("Authorization", `Bearer ${idToken}`);

  return fetch(input, {
    ...init,
    headers,
  });
}

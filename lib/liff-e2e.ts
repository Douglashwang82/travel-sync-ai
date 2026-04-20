"use client";

type LiffE2EContext = {
  isReady?: boolean;
  isLoggedIn?: boolean;
  profile?: {
    userId: string;
    displayName: string;
    pictureUrl?: string;
  } | null;
  lineGroupId?: string | null;
  error?: string | null;
  idToken?: string | null;
};

declare global {
  interface Window {
    __LIFF_E2E_CONTEXT__?: LiffE2EContext;
  }
}

export function isLiffE2EModeEnabled(): boolean {
  return process.env.NEXT_PUBLIC_E2E_LIFF_MOCK === "1";
}

export function getLiffE2EContext(): LiffE2EContext | null {
  if (!isLiffE2EModeEnabled() || typeof window === "undefined") {
    return null;
  }

  return (
    window.__LIFF_E2E_CONTEXT__ ?? {
      isReady: true,
      isLoggedIn: true,
      profile: {
        userId: "U_E2E_USER",
        displayName: "E2E Traveler",
      },
      // null = private chat / browser context (no group).
      // Set to "C_E2E_GROUP" in __LIFF_E2E_CONTEXT__ to simulate group chat.
      lineGroupId: null,
      error: null,
      idToken: "e2e-liff-token",
    }
  );
}

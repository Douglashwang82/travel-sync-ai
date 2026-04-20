"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { getLiffE2EContext } from "@/lib/liff-e2e";
import { stashLineGroupId, popLineGroupId } from "@/lib/liff-group-context";

interface LiffProfile {
  userId: string;
  displayName: string;
  pictureUrl?: string;
}

// Mirrors the LIFF context types that matter for routing logic
export type LiffContextType = "group" | "utou" | "external" | null;

interface LiffContext {
  isReady: boolean;
  isLoggedIn: boolean;
  profile: LiffProfile | null;
  lineGroupId: string | null;
  /** How the LIFF was opened: "group", "utou" (private chat), "external" (browser), or null (not yet resolved) */
  liffContextType: LiffContextType;
  error: string | null;
}

const LiffCtx = createContext<LiffContext>({
  isReady: false,
  isLoggedIn: false,
  profile: null,
  lineGroupId: null,
  liffContextType: null,
  error: null,
});

export function useLiff() {
  return useContext(LiffCtx);
}

export function LiffProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<LiffContext>({
    isReady: false,
    isLoggedIn: false,
    profile: null,
    lineGroupId: null,
    liffContextType: null,
    error: null,
  });

  useEffect(() => {
    const e2eContext = getLiffE2EContext();
    if (e2eContext) {
      const ctxType: LiffContextType = e2eContext.lineGroupId ? "group" : "utou";
      setState({
        isReady: e2eContext.isReady ?? true,
        isLoggedIn: e2eContext.isLoggedIn ?? true,
        profile: e2eContext.profile ?? null,
        lineGroupId: e2eContext.lineGroupId ?? null,
        liffContextType: ctxType,
        error: e2eContext.error ?? null,
      });
      return;
    }

    const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
    if (!liffId) {
      setState((s) => ({ ...s, isReady: true, error: "LIFF ID not configured" }));
      return;
    }

    async function initLiff() {
      try {
        const liff = (await import("@line/liff")).default;
        await liff.init({ liffId: liffId! });

        if (!liff.isLoggedIn()) {
          // Stash the group context before the OAuth redirect — LIFF may not
          // restore it after returning from the LINE login page.
          const preLoginCtx = liff.getContext();
          const preLoginGroupId =
            preLoginCtx?.type === "group" ? preLoginCtx.groupId : null;
          if (preLoginGroupId) stashLineGroupId(preLoginGroupId);
          liff.login();
          return;
        }

        const profile = await liff.getProfile();
        const context = liff.getContext();
        // liff.getContext() can lose group context after the LINE OAuth redirect.
        // Restore from sessionStorage if needed.
        const groupId =
          context?.type === "group"
            ? context.groupId
            : popLineGroupId();
        const ctxType: LiffContextType =
          groupId ? "group"
          : context?.type === "utou" ? "utou"
          : "external";

        setState({
          isReady: true,
          isLoggedIn: true,
          profile: {
            userId: profile.userId,
            displayName: profile.displayName,
            pictureUrl: profile.pictureUrl,
          },
          lineGroupId: groupId ?? null,
          liffContextType: ctxType,
          error: null,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "LIFF init failed";
        setState((s) => ({ ...s, isReady: true, error: message }));
      }
    }

    initLiff();
  }, []);

  return <LiffCtx.Provider value={state}>{children}</LiffCtx.Provider>;
}

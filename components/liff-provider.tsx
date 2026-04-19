"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { getLiffE2EContext } from "@/lib/liff-e2e";
import { stashLineGroupId, popLineGroupId } from "@/lib/liff-group-context";

interface LiffProfile {
  userId: string;
  displayName: string;
  pictureUrl?: string;
}

interface LiffContext {
  isReady: boolean;
  isLoggedIn: boolean;
  profile: LiffProfile | null;
  lineGroupId: string | null;
  error: string | null;
}

const LiffCtx = createContext<LiffContext>({
  isReady: false,
  isLoggedIn: false,
  profile: null,
  lineGroupId: null,
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
    error: null,
  });

  useEffect(() => {
    const e2eContext = getLiffE2EContext();
    if (e2eContext) {
      setState({
        isReady: e2eContext.isReady ?? true,
        isLoggedIn: e2eContext.isLoggedIn ?? true,
        profile: e2eContext.profile ?? null,
        lineGroupId: e2eContext.lineGroupId ?? null,
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
        const groupId =
          (context?.type === "group" ? context.groupId : null) ??
          popLineGroupId();

        setState({
          isReady: true,
          isLoggedIn: true,
          profile: {
            userId: profile.userId,
            displayName: profile.displayName,
            pictureUrl: profile.pictureUrl,
          },
          lineGroupId: groupId ?? null,
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

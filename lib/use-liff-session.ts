"use client";

import { useCallback, useEffect, useState } from "react";
import { useLiff } from "@/components/liff-provider";
import { liffFetch } from "@/lib/liff-client";
import { toLiffErrorMessage } from "@/lib/liff-errors";

export type LiffSessionData = {
  group: { id: string; lineGroupId: string; name: string | null };
  member: { lineUserId: string; role: string };
  activeTrip: {
    id: string;
    destination_name: string;
    destination_place_id: string | null;
    destination_formatted_address: string | null;
    destination_google_maps_url: string | null;
    destination_lat: number | null;
    destination_lng: number | null;
    destination_timezone: string | null;
    destination_source_last_synced_at: string | null;
    start_date: string | null;
    end_date: string | null;
    status?: string;
  } | null;
};

export function useLiffSession() {
  const liff = useLiff();
  const { isReady, isLoggedIn, profile, lineGroupId } = liff;
  const [session, setSession] = useState<LiffSessionData | null>(null);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);

  const reloadSession = useCallback(async () => {
    if (!profile || !lineGroupId) return null;

    setSessionLoading(true);
    setSessionError(null);

    try {
      const sessionRes = await liffFetch(
        `/api/liff/session?lineGroupId=${encodeURIComponent(lineGroupId)}&lineUserId=${encodeURIComponent(profile.userId)}&displayName=${encodeURIComponent(profile.displayName)}`
      );

      if (!sessionRes.ok) {
        throw new Error("Failed to load session");
      }

      const sessionData: LiffSessionData = await sessionRes.json();
      setSession(sessionData);
      return sessionData;
    } catch (err) {
      const message = toLiffErrorMessage(
        "session",
        err,
        "We could not verify your LINE session. Reopen this page inside LINE and try again."
      );
      setSessionError(message);
      return null;
    } finally {
      setSessionLoading(false);
    }
  }, [profile, lineGroupId]);

  useEffect(() => {
    if (isReady && isLoggedIn) {
      void reloadSession();
    }
  }, [isReady, isLoggedIn, reloadSession]);

  return {
    ...liff,
    session,
    sessionLoading,
    sessionError,
    reloadSession,
  };
}

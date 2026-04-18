"use client";

import { useCallback, useEffect, useState } from "react";
import { EmptyState, ErrorScreen, ListSkeleton, LoadingSpinner } from "@/components/liff/shared";
import { Badge } from "@/components/ui/badge";
import { liffFetch } from "@/lib/liff-client";
import { toLiffErrorMessage } from "@/lib/liff-errors";
import { useLiffSession } from "@/lib/use-liff-session";

type EmergencyNumbers = {
  police: string;
  ambulance: string;
  fire: string;
  embassy?: string;
};

type Member = {
  lineUserId: string;
  displayName: string | null;
  isYou: boolean;
};

type EmergencyData = {
  trip: {
    id: string;
    destinationName: string;
    destinationAddress: string | null;
    destinationMapUrl: string | null;
    startDate: string | null;
    endDate: string | null;
  } | null;
  countryCode: string | null;
  emergencyNumbers: EmergencyNumbers | null;
  organizer: { lineUserId: string; displayName: string | null } | null;
  members: Member[];
};

function PhoneLink({ number, label }: { number: string; label: string }) {
  return (
    <a
      href={`tel:${number}`}
      className="flex items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3 transition-colors active:bg-[var(--secondary)]"
    >
      <span className="text-sm font-medium">{label}</span>
      <span className="text-sm font-bold text-[var(--primary)]">{number}</span>
    </a>
  );
}

export default function EmergencyPage() {
  const { isReady, isLoggedIn, error, session, sessionLoading, sessionError, reloadSession } =
    useLiffSession();
  const [data, setData] = useState<EmergencyData | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const s = await reloadSession();
      if (!s) throw new Error("No session");
      const res = await liffFetch(
        `/api/liff/emergency?lineGroupId=${encodeURIComponent(s.group.lineGroupId)}&lineUserId=${encodeURIComponent(s.member.lineUserId)}`
      );
      if (!res.ok) throw new Error("Failed to load emergency data");
      setData(await res.json());
    } catch (err) {
      setLoadError(toLiffErrorMessage("emergency", err, "Could not load emergency contacts."));
    } finally {
      setLoading(false);
    }
  }, [reloadSession]);

  useEffect(() => {
    if (!isReady || !isLoggedIn || !session || sessionLoading) return;
    void (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const res = await liffFetch(
          `/api/liff/emergency?lineGroupId=${encodeURIComponent(session.group.lineGroupId)}&lineUserId=${encodeURIComponent(session.member.lineUserId)}`
        );
        if (!res.ok) throw new Error("Failed to load emergency data");
        setData(await res.json());
      } catch (err) {
        setLoadError(toLiffErrorMessage("emergency", err, "Could not load emergency contacts."));
      } finally {
        setLoading(false);
      }
    })();
  }, [isReady, isLoggedIn, session, sessionLoading]);

  if (!isReady) return <LoadingSpinner message="Initializing..." />;
  if (error) return <ErrorScreen message={error} />;
  if (!isLoggedIn) return <LoadingSpinner message="Logging in..." />;
  if (sessionLoading && !session) return <ListSkeleton rows={4} />;
  if (sessionError && !session) return <ErrorScreen message={sessionError} onRetry={load} />;
  if (loading) return <ListSkeleton rows={4} />;
  if (loadError) return <ErrorScreen message={loadError} onRetry={load} />;

  if (!data) {
    return (
      <EmptyState
        emoji="🚨"
        title="No trip active"
        description="Start a trip first to see emergency contacts."
      />
    );
  }

  const { trip, emergencyNumbers, organizer, members, countryCode } = data;

  return (
    <div className="mx-auto max-w-md">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-[var(--border)] bg-red-600 px-4 py-3 text-white">
        <p className="text-xs font-medium uppercase tracking-widest opacity-80">Emergency</p>
        <h1 className="mt-1 text-base font-bold">Emergency Contacts</h1>
        {trip && (
          <p className="mt-0.5 text-xs opacity-75">
            {trip.destinationName}
            {trip.startDate && trip.endDate ? ` · ${trip.startDate} – ${trip.endDate}` : ""}
          </p>
        )}
      </div>

      <div className="space-y-5 px-4 pb-6 pt-4">
        {/* Local emergency numbers */}
        {emergencyNumbers ? (
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Local Emergency Numbers</h2>
              {countryCode && (
                <Badge variant="outline" className="text-xs">
                  {countryCode}
                </Badge>
              )}
            </div>
            <div className="space-y-2">
              <PhoneLink number={emergencyNumbers.police} label="🚔 Police" />
              <PhoneLink number={emergencyNumbers.ambulance} label="🚑 Ambulance" />
              <PhoneLink number={emergencyNumbers.fire} label="🚒 Fire" />
              {emergencyNumbers.embassy && (
                <PhoneLink number={emergencyNumbers.embassy} label="🏛️ Embassy (TW)" />
              )}
            </div>
          </section>
        ) : (
          <section className="rounded-xl border border-amber-200 bg-amber-50 p-4">
            <p className="text-sm text-amber-800">
              Emergency numbers not available for this destination. Search for local emergency
              services before you travel.
            </p>
          </section>
        )}

        {/* Destination info */}
        {trip?.destinationMapUrl && (
          <section>
            <h2 className="mb-2 text-sm font-semibold">Location</h2>
            <a
              href={trip.destinationMapUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3"
            >
              <div>
                <p className="text-sm font-medium">{trip.destinationName}</p>
                {trip.destinationAddress && (
                  <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
                    {trip.destinationAddress}
                  </p>
                )}
              </div>
              <span className="text-xs text-[var(--primary)]">Open map →</span>
            </a>
          </section>
        )}

        {/* Trip organizer */}
        {organizer && (
          <section>
            <h2 className="mb-2 text-sm font-semibold">Trip Organizer</h2>
            <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3">
              <p className="text-sm font-medium">{organizer.displayName ?? "Organizer"}</p>
              <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
                Contact them if the group needs coordination during an emergency.
              </p>
            </div>
          </section>
        )}

        {/* Group members */}
        {members.length > 0 && (
          <section>
            <h2 className="mb-2 text-sm font-semibold">Group Members</h2>
            <div className="divide-y divide-[var(--border)] overflow-hidden rounded-xl border border-[var(--border)]">
              {members.map((m) => (
                <div key={m.lineUserId} className="flex items-center justify-between px-4 py-3">
                  <p className="text-sm">{m.displayName ?? m.lineUserId}</p>
                  {m.isYou && (
                    <Badge variant="secondary" className="text-xs">
                      You
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Incident bot reminder */}
        <section className="rounded-xl border border-red-200 bg-red-50 p-4">
          <p className="text-sm font-semibold text-red-800">In an emergency?</p>
          <p className="mt-1 text-sm leading-relaxed text-red-700">
            Call the local emergency number first. Then use{" "}
            <span className="font-mono font-semibold">/incident [what happened]</span> in the
            group chat to activate the TravelSync emergency playbook.
          </p>
        </section>
      </div>
    </div>
  );
}

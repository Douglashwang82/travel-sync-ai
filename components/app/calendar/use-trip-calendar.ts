"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { appFetchJson } from "@/lib/app-client";
import type {
  AvailabilityMark,
  AvailabilityResponse,
  AvailabilityStatus,
} from "@/app/api/app/trips/[tripId]/availability/route";
import type {
  HolidaysResponse,
} from "@/app/api/app/trips/[tripId]/holidays/route";
import type { CalendarSettings } from "@/app/api/app/trips/[tripId]/calendar-settings/route";
import type { AppMember } from "@/app/api/app/trips/[tripId]/members/route";
import type { Holiday } from "@/lib/holidays";
import type { Trip } from "@/lib/types";

export interface DayInfo {
  date: string;
  isToday: boolean;
  isInTripWindow: boolean;
  holidays: Holiday[];
  marks: AvailabilityMark[];
  myMark: AvailabilityMark | null;
  freeCount: number;
  maybeCount: number;
  busyCount: number;
}

export interface TripCalendarState {
  loading: boolean;
  error: string | null;
  trip: { startDate: string | null; endDate: string | null } | null;
  members: AppMember[];
  currentUserId: string | null;
  countryCodes: string[];
  monthCursor: { year: number; month: number }; // month: 0-11
  days: Map<string, DayInfo>;
}

const todayString = () => new Date().toISOString().slice(0, 10);

function monthBoundsISO(year: number, month: number): { from: string; to: string } {
  // We grab a generous window (one month before/after) so navigation feels
  // instant and holiday data is preloaded for the previous/next view.
  const from = new Date(Date.UTC(year, month - 1, 1)).toISOString().slice(0, 10);
  const to = new Date(Date.UTC(year, month + 2, 0)).toISOString().slice(0, 10);
  return { from, to };
}

/**
 * Bundle the four async fetches the calendar needs:
 *   - the trip (for window + destination metadata)
 *   - members (so the heatmap can show avatars)
 *   - per-user calendar settings (which countries' holidays to show)
 *   - holidays + availability for the visible window
 */
export function useTripCalendar(tripId: string) {
  const [monthCursor, setMonthCursor] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  const [trip, setTrip] = useState<{
    startDate: string | null;
    endDate: string | null;
  } | null>(null);
  const [members, setMembers] = useState<AppMember[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [countryCodes, setCountryCodes] = useState<string[]>([]);
  const [marks, setMarks] = useState<AvailabilityMark[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // One-time load: trip, members, settings.
  const loadBase = useCallback(async () => {
    try {
      const [tripRes, membersRes, settingsRes] = await Promise.all([
        appFetchJson<{ trip: Trip; role: string }>(`/api/app/trips/${tripId}`),
        appFetchJson<{ members: AppMember[] }>(
          `/api/app/trips/${tripId}/members`
        ),
        appFetchJson<CalendarSettings>(
          `/api/app/trips/${tripId}/calendar-settings`
        ),
      ]);
      setTrip({
        startDate: tripRes.trip.start_date ?? null,
        endDate: tripRes.trip.end_date ?? null,
      });
      setMembers(membersRes.members);
      setCountryCodes(settingsRes.countryCodes);

      // Center the cursor on the trip window if we have one and we're not
      // already inside it. This makes the tile useful on first render even
      // when "today" is months away from the trip.
      if (tripRes.trip.start_date) {
        const tripStart = new Date(tripRes.trip.start_date + "T00:00:00");
        const tripEnd = tripRes.trip.end_date
          ? new Date(tripRes.trip.end_date + "T00:00:00")
          : tripStart;
        const now = new Date();
        if (now < tripStart || now > tripEnd) {
          setMonthCursor({
            year: tripStart.getFullYear(),
            month: tripStart.getMonth(),
          });
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load calendar");
    }
  }, [tripId]);

  // Per-cursor reload: holidays + availability for the visible window.
  const loadWindow = useCallback(async () => {
    const { from, to } = monthBoundsISO(monthCursor.year, monthCursor.month);
    try {
      const [availRes, holidaysRes] = await Promise.all([
        appFetchJson<AvailabilityResponse>(
          `/api/app/trips/${tripId}/availability?from=${from}&to=${to}`
        ),
        countryCodes.length === 0
          ? Promise.resolve<HolidaysResponse>({ holidays: [] })
          : appFetchJson<HolidaysResponse>(
              `/api/app/trips/${tripId}/holidays?countries=${countryCodes.join(",")}&from=${from}&to=${to}`
            ),
      ]);
      setMarks(availRes.marks);
      setCurrentUserId(availRes.currentUser.lineUserId);
      setHolidays(holidaysRes.holidays);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load calendar");
    }
  }, [tripId, monthCursor, countryCodes]);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      await loadBase();
      setLoading(false);
    })();
  }, [loadBase]);

  useEffect(() => {
    void (async () => {
      await loadWindow();
    })();
  }, [loadWindow]);

  // Index holidays + marks by date for O(1) per-cell access.
  const days = useMemo(() => {
    const today = todayString();
    const map = new Map<string, DayInfo>();
    const ensure = (date: string): DayInfo => {
      let info = map.get(date);
      if (!info) {
        info = {
          date,
          isToday: date === today,
          isInTripWindow:
            (!trip?.startDate || date >= trip.startDate) &&
            (!trip?.endDate || date <= trip.endDate),
          holidays: [],
          marks: [],
          myMark: null,
          freeCount: 0,
          maybeCount: 0,
          busyCount: 0,
        };
        map.set(date, info);
      }
      return info;
    };

    for (const h of holidays) ensure(h.date).holidays.push(h);
    for (const m of marks) {
      const info = ensure(m.date);
      info.marks.push(m);
      if (m.lineUserId === currentUserId) info.myMark = m;
      if (m.status === "free") info.freeCount++;
      else if (m.status === "maybe") info.maybeCount++;
      else info.busyCount++;
    }
    return map;
  }, [holidays, marks, trip, currentUserId]);

  const setMyMark = useCallback(
    async (date: string, status: AvailabilityStatus | null, note?: string) => {
      // Optimistic update so the UI feels instant; reconcile on failure.
      setMarks((prev) => {
        const filtered = prev.filter(
          (m) => !(m.date === date && m.lineUserId === currentUserId)
        );
        if (status === null || !currentUserId) return filtered;
        return [
          ...filtered,
          {
            lineUserId: currentUserId,
            date,
            status,
            note: note?.trim() || null,
          },
        ];
      });
      try {
        await appFetchJson(`/api/app/trips/${tripId}/availability`, {
          method: "PATCH",
          body: JSON.stringify({ date, status, note: note ?? null }),
        });
      } catch {
        // Reload to recover from optimistic divergence.
        void loadWindow();
      }
    },
    [tripId, currentUserId, loadWindow]
  );

  const setMyRangeMark = useCallback(
    async (from: string, to: string, status: AvailabilityStatus | null) => {
      try {
        await appFetchJson(`/api/app/trips/${tripId}/availability`, {
          method: "PATCH",
          body: JSON.stringify({ range: { from, to }, status }),
        });
        await loadWindow();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save");
      }
    },
    [tripId, loadWindow]
  );

  const updateCountries = useCallback(
    async (codes: string[]) => {
      try {
        const res = await appFetchJson<CalendarSettings>(
          `/api/app/trips/${tripId}/calendar-settings`,
          {
            method: "PATCH",
            body: JSON.stringify({ countryCodes: codes }),
          }
        );
        setCountryCodes(res.countryCodes);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save");
      }
    },
    [tripId]
  );

  const goPrev = useCallback(() => {
    setMonthCursor((c) =>
      c.month === 0
        ? { year: c.year - 1, month: 11 }
        : { year: c.year, month: c.month - 1 }
    );
  }, []);

  const goNext = useCallback(() => {
    setMonthCursor((c) =>
      c.month === 11
        ? { year: c.year + 1, month: 0 }
        : { year: c.year, month: c.month + 1 }
    );
  }, []);

  const goToday = useCallback(() => {
    const d = new Date();
    setMonthCursor({ year: d.getFullYear(), month: d.getMonth() });
  }, []);

  return {
    loading,
    error,
    trip,
    members,
    currentUserId,
    countryCodes,
    monthCursor,
    days,
    goPrev,
    goNext,
    goToday,
    setMyMark,
    setMyRangeMark,
    updateCountries,
    reload: loadWindow,
  };
}

/**
 * Response shape of `GET /api/app/session`. Mirrors the interfaces exported by
 * `app/api/app/session/route.ts` — keep these in sync until the route imports
 * from this package directly (full workspace restructure).
 */

export interface SessionGroup {
  id: string;
  lineGroupId: string;
  name: string | null;
  role: "organizer" | "member";
}

export interface SessionTripSummary {
  id: string;
  groupId: string | null;
  destinationName: string | null;
  startDate: string | null;
  endDate: string | null;
  status: string;
  itemCount: number;
}

export interface SessionResponse {
  lineUserId: string;
  appUserId: string;
  email: string | null;
  displayName: string | null;
  groups: SessionGroup[];
  trips: SessionTripSummary[];
}

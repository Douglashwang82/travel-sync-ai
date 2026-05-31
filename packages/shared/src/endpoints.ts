/**
 * Path builders for the `/api/app/*` surface. Centralising them keeps the
 * mobile and web clients in lockstep with the routes under `app/api/app/`.
 * These are paths only — the base URL is supplied by the client.
 */
export const endpoints = {
  auth: {
    mobileLogin: "/api/app/auth/mobile/login",
    mobileRefresh: "/api/app/auth/mobile/refresh",
    mobileLine: "/api/app/auth/mobile/line",
    lineConfig: "/api/app/auth/line/config",
  },
  me: "/api/app/me",
  session: "/api/app/session",
  notifications: {
    list: "/api/app/notifications",
    unreadCount: "/api/app/notifications/unread-count",
    read: "/api/app/notifications/read",
  },
  trips: {
    get: (tripId: string) => `/api/app/trips/${tripId}`,
    board: (tripId: string) => `/api/app/trips/${tripId}/board`,
    itinerary: (tripId: string) => `/api/app/trips/${tripId}/itinerary`,
    votes: (tripId: string) => `/api/app/trips/${tripId}/votes`,
    expenses: (tripId: string) => `/api/app/trips/${tripId}/expenses`,
    pack: (tripId: string) => `/api/app/trips/${tripId}/pack`,
    members: (tripId: string) => `/api/app/trips/${tripId}/members`,
  },
} as const;

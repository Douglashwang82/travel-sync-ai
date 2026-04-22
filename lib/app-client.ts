/**
 * Browser fetch helper for the /app experience.
 *
 * Always sends credentials so the `ts_app_user` session cookie is included
 * on cross-origin previews, and normalises error shapes to a single format.
 */

export type AppApiError = { error: string; code: string; details?: unknown };

export class AppApiFetchError extends Error {
  code: string;
  status: number;
  details?: unknown;

  constructor(message: string, code: string, status: number, details?: unknown) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export async function appFetch(
  input: string,
  init?: RequestInit
): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(input, {
    ...init,
    credentials: "include",
    headers,
  });
}

export async function appFetchJson<T>(
  input: string,
  init?: RequestInit
): Promise<T> {
  const res = await appFetch(input, init);
  if (!res.ok) {
    let err: AppApiError = { error: `Request failed (${res.status})`, code: "HTTP_ERROR" };
    try {
      err = (await res.json()) as AppApiError;
    } catch {
      // Non-JSON response; keep default error.
    }
    throw new AppApiFetchError(err.error, err.code, res.status, err.details);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

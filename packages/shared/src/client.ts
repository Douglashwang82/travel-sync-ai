import { ApiError, type ApiErrorBody } from "./errors.js";
import { endpoints } from "./endpoints.js";
import type {
  MobileLoginResponse,
  MobileRefreshResponse,
  TokenPair,
} from "./auth.js";

/**
 * Where the client reads/writes tokens. The mobile app backs this with
 * `expo-secure-store` (Keychain / Keystore); tests can use an in-memory stub.
 */
export interface TokenStore {
  getAccessToken(): Promise<string | null>;
  getRefreshToken(): Promise<string | null>;
  setTokens(pair: TokenPair): Promise<void>;
  clear(): Promise<void>;
}

export interface ApiClientOptions {
  baseUrl: string;
  store: TokenStore;
  /** Injectable for tests / non-global-fetch runtimes. */
  fetchImpl?: typeof fetch;
  /** Called when refresh fails and the session is unrecoverable. */
  onAuthLost?: () => void;
}

/**
 * Token-aware API client for the `/api/app/*` surface.
 *
 * - Attaches `Authorization: Bearer <accessToken>` to every request.
 * - On a 401, attempts a one-shot refresh via the stored refresh token and
 *   replays the original request; if refresh fails it clears the session and
 *   invokes `onAuthLost`.
 * - Normalises all failures into `ApiError`.
 */
export class ApiClient {
  private readonly baseUrl: string;
  private readonly store: TokenStore;
  private readonly fetchImpl: typeof fetch;
  private readonly onAuthLost?: () => void;
  private refreshing: Promise<boolean> | null = null;

  constructor(opts: ApiClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.store = opts.store;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.onAuthLost = opts.onAuthLost;
  }

  // ─── Auth ────────────────────────────────────────────────────────────────

  async loginWithEmail(email: string, password: string): Promise<MobileLoginResponse> {
    const res = await this.raw(endpoints.auth.mobileLogin, {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    const json = (await this.parse(res)) as MobileLoginResponse;
    await this.store.setTokens(json);
    return json;
  }

  async loginWithLine(idToken: string, nonce: string): Promise<MobileLoginResponse> {
    const res = await this.raw(endpoints.auth.mobileLine, {
      method: "POST",
      body: JSON.stringify({ idToken, nonce }),
    });
    const json = (await this.parse(res)) as MobileLoginResponse;
    await this.store.setTokens(json);
    return json;
  }

  async logout(): Promise<void> {
    await this.store.clear();
  }

  // ─── Typed JSON helpers (auto-attach + refresh) ────────────────────────────

  get<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: "GET" });
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, {
      method: "POST",
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, {
      method: "PATCH",
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  delete<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: "DELETE" });
  }

  // ─── Internals ─────────────────────────────────────────────────────────────

  private async request<T>(path: string, init: RequestInit, retry = true): Promise<T> {
    const accessToken = await this.store.getAccessToken();
    const res = await this.raw(path, init, accessToken);

    if (res.status === 401 && retry) {
      const refreshed = await this.refresh();
      if (refreshed) return this.request<T>(path, init, false);
      await this.store.clear();
      this.onAuthLost?.();
    }

    return this.parse(res) as Promise<T>;
  }

  private async raw(
    path: string,
    init: RequestInit,
    accessToken?: string | null
  ): Promise<Response> {
    const headers = new Headers(init.headers);
    if (init.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
    return this.fetchImpl(`${this.baseUrl}${path}`, { ...init, headers });
  }

  /** One-shot, de-duplicated refresh. Concurrent 401s share a single attempt. */
  private refresh(): Promise<boolean> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      try {
        const refreshToken = await this.store.getRefreshToken();
        if (!refreshToken) return false;
        const res = await this.raw(endpoints.auth.mobileRefresh, {
          method: "POST",
          body: JSON.stringify({ refreshToken }),
        });
        if (!res.ok) return false;
        const json = (await res.json()) as MobileRefreshResponse;
        await this.store.setTokens(json);
        return true;
      } catch {
        return false;
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }

  private async parse(res: Response): Promise<unknown> {
    if (!res.ok) {
      let body: ApiErrorBody = {
        error: `Request failed (${res.status})`,
        code: "HTTP_ERROR",
      };
      try {
        body = (await res.json()) as ApiErrorBody;
      } catch {
        // Non-JSON error response; keep the default.
      }
      throw new ApiError(body.error, body.code, res.status, body.details);
    }
    if (res.status === 204) return undefined;
    return res.json();
  }
}

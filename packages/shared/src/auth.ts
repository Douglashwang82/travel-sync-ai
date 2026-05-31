/**
 * Contracts for the mobile auth endpoints under `/api/app/auth/mobile/*`.
 * Mirrors the server responses produced in `app/api/app/auth/mobile/`.
 */

export interface AuthUser {
  id: string;
  email: string | null;
  displayName: string | null;
  avatarUrl?: string | null;
}

/** Token pair returned by login / refresh / line-exchange. */
export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  /** Seconds until the access token expires. */
  expiresIn: number;
  tokenType: "Bearer";
}

export interface MobileLoginRequest {
  email: string;
  password: string;
}

export interface MobileLoginResponse extends TokenPair {
  ok: true;
  user: AuthUser;
}

export interface MobileLineExchangeRequest {
  /** The LINE id_token obtained from the Expo PKCE flow. */
  idToken: string;
  /** The nonce the client generated and passed to LINE. */
  nonce: string;
}

export type MobileLineExchangeResponse = MobileLoginResponse;

export interface MobileRefreshRequest {
  refreshToken: string;
}

export interface MobileRefreshResponse extends TokenPair {
  ok: true;
}

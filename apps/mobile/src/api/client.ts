import Constants from "expo-constants";
import { ApiClient } from "@travel-sync/shared";
import { secureTokenStore } from "./secure-store";

const apiBaseUrl =
  (Constants.expoConfig?.extra?.apiBaseUrl as string | undefined) ??
  "https://app.travelsync.ai";

/**
 * App-wide API client. `onAuthLost` is wired by the AuthProvider so an
 * unrecoverable 401 (failed refresh) bounces the user back to sign-in.
 */
let authLostHandler: (() => void) | undefined;

export function setAuthLostHandler(fn: () => void): void {
  authLostHandler = fn;
}

export const api = new ApiClient({
  baseUrl: apiBaseUrl,
  store: secureTokenStore,
  onAuthLost: () => authLostHandler?.(),
});

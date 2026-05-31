import * as SecureStore from "expo-secure-store";
import type { TokenPair, TokenStore } from "@travel-sync/shared";

const ACCESS_KEY = "ts_access_token";
const REFRESH_KEY = "ts_refresh_token";

/**
 * Token storage backed by the device keychain (iOS) / keystore (Android) via
 * `expo-secure-store`. Never use AsyncStorage for tokens — it is plaintext.
 */
export const secureTokenStore: TokenStore = {
  async getAccessToken() {
    return SecureStore.getItemAsync(ACCESS_KEY);
  },
  async getRefreshToken() {
    return SecureStore.getItemAsync(REFRESH_KEY);
  },
  async setTokens(pair: TokenPair) {
    await Promise.all([
      SecureStore.setItemAsync(ACCESS_KEY, pair.accessToken),
      SecureStore.setItemAsync(REFRESH_KEY, pair.refreshToken),
    ]);
  },
  async clear() {
    await Promise.all([
      SecureStore.deleteItemAsync(ACCESS_KEY),
      SecureStore.deleteItemAsync(REFRESH_KEY),
    ]);
  },
};

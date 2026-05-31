import type { ExpoConfig, ConfigContext } from "expo/config";

/**
 * Expo app config. Runtime values (API base URL, LINE Login channel id) come
 * from environment variables so they can be injected per-build via EAS
 * secrets — mirroring the web app's `.env.local` discipline.
 */
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "TravelSync",
  slug: "travel-sync",
  scheme: "travelsync",
  version: "0.1.0",
  orientation: "portrait",
  userInterfaceStyle: "automatic",
  newArchEnabled: true,
  ios: {
    supportsTablet: true,
    bundleIdentifier: "ai.travelsync.app",
    associatedDomains: ["applinks:app.travelsync.ai"],
  },
  android: {
    package: "ai.travelsync.app",
    intentFilters: [
      {
        action: "VIEW",
        autoVerify: true,
        data: [{ scheme: "https", host: "app.travelsync.ai" }],
        category: ["BROWSABLE", "DEFAULT"],
      },
    ],
  },
  plugins: ["expo-router", "expo-secure-store"],
  experiments: { typedRoutes: true },
  extra: {
    apiBaseUrl:
      process.env.EXPO_PUBLIC_API_BASE_URL ?? "https://app.travelsync.ai",
    lineLoginChannelId: process.env.EXPO_PUBLIC_LINE_LOGIN_CHANNEL_ID ?? "",
  },
});

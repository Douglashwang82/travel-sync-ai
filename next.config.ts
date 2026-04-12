import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  /* config options here */
};

export default withSentryConfig(nextConfig, {
  // Sentry organisation and project (set these in your CI or .env.local)
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,

  // Silences Sentry CLI output during builds
  silent: !process.env.CI,

  // Upload source maps to Sentry for readable stack traces in production.
  // Requires SENTRY_AUTH_TOKEN to be set in the build environment.
  widenClientFileUpload: true,

  // Automatically instrument Next.js Data Fetching methods with error monitoring
  autoInstrumentServerFunctions: true,

  // Hides source maps from the client bundle (they are only uploaded to Sentry)
  hideSourceMaps: true,

  // Reduces bundle size by tree-shaking unused Sentry features
  disableLogger: true,
});

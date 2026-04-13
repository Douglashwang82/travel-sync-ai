import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Instrumentation hook (instrumentation.ts) must be explicitly enabled
  // to initialise Sentry before the first request is processed.
  experimental: {
    instrumentationHook: true,
  },
};

export default nextConfig;

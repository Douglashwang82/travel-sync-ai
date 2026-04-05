/**
 * Global Vitest setup — runs once before each test file.
 *
 * Stubs out process.env so services that call validateEnv() don't crash,
 * and ensures module-level singletons (rate-limiter store) are reset
 * between test files via module isolation (vitest `isolate: true`).
 */

// Minimal env stubs required by lib/env.ts validateEnv()
process.env.LINE_CHANNEL_SECRET = "test-channel-secret";
process.env.LINE_CHANNEL_ACCESS_TOKEN = "test-access-token";
process.env.NEXT_PUBLIC_LIFF_ID = "test-liff-id";
process.env.SUPABASE_URL = "https://test.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.GOOGLE_GEMINI_API_KEY = "test-gemini-key";
process.env.GOOGLE_PLACES_API_KEY = "test-places-key";
process.env.CRON_SECRET = "test-cron-secret";
process.env.NEXT_PUBLIC_APP_URL = "https://test.example.com";

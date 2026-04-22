/**
 * Environment variable validation.
 *
 * Call `validateEnv()` at the top of long-running server entry points
 * (e.g. the webhook handler on first request) to fail fast with a clear
 * error instead of a cryptic runtime crash later.
 *
 * Not called during build time - `!` assertions in other files handle that.
 */

interface EnvVar {
  key: string;
  required: boolean;
  description: string;
}

const SERVER_ENV_VARS: EnvVar[] = [
  { key: "LINE_CHANNEL_SECRET", required: true, description: "LINE channel secret for webhook signature verification" },
  { key: "LINE_CHANNEL_ACCESS_TOKEN", required: true, description: "LINE channel access token for sending messages" },
  { key: "NEXT_PUBLIC_SUPABASE_URL", required: true, description: "Supabase project URL" },
  { key: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", required: true, description: "Supabase anon/publishable key" },
  { key: "SUPABASE_SECRET_KEY", required: true, description: "Supabase service role key (server-side only)" },
  { key: "GEMINI_API_KEY", required: true, description: "Google Gemini API key for LLM parsing" },
  { key: "GOOGLE_PLACES_API_KEY", required: false, description: "Google Places API key for place search and enrichment" },
  { key: "GOOGLE_MAPS_SERVER_API_KEY", required: false, description: "Unified Google Maps Platform server-side key for Places, Routes, Time Zone, Weather, and Static Maps" },
  { key: "GOOGLE_ROUTES_API_KEY", required: false, description: "Google Routes API key for travel time estimation" },
  { key: "GOOGLE_WEATHER_API_KEY", required: false, description: "Google Weather API key for daily briefing enrichment" },
  { key: "GOOGLE_STATIC_MAPS_API_KEY", required: false, description: "Google Static Maps API key for map image previews" },
  { key: "GOOGLE_CLIENT_ID", required: false, description: "Google OAuth client ID for optional Calendar export" },
  { key: "GOOGLE_CLIENT_SECRET", required: false, description: "Google OAuth client secret for optional Calendar export" },
  { key: "GOOGLE_REDIRECT_URI", required: false, description: "Google OAuth redirect URI for optional Calendar export" },
  { key: "NEXT_PUBLIC_LIFF_ID", required: false, description: "LINE LIFF app ID (required for LIFF pages to work)" },
  { key: "LIFF_CHANNEL_ID", required: false, description: "LINE channel ID for LIFF ID token verification (required for LIFF API routes)" },
  { key: "LINE_LOGIN_CHANNEL_ID", required: false, description: "LINE Login (web) channel ID — required to enable real sign-in on the /app workspace" },
  { key: "LINE_LOGIN_CHANNEL_SECRET", required: false, description: "LINE Login (web) channel secret — required with LINE_LOGIN_CHANNEL_ID" },
  { key: "LINE_LOGIN_REDIRECT_URI", required: false, description: "Optional override for the LINE Login callback URL; defaults to {origin}/api/app/auth/line/callback" },
  { key: "CRON_SECRET", required: false, description: "Secret for Vercel cron route auth (required in production)" },
];

let validated = false;

export function validateEnv(): void {
  if (validated) return;
  validated = true;

  const missing: string[] = [];
  const warnings: string[] = [];

  for (const v of SERVER_ENV_VARS) {
    const value = process.env[v.key];
    if (!value) {
      if (v.required) {
        missing.push(`  [missing] ${v.key} - ${v.description}`);
      } else {
        warnings.push(`  [optional] ${v.key} - ${v.description}`);
      }
    }
  }

  if (warnings.length > 0) {
    console.warn("[env] Optional env vars not set:\n" + warnings.join("\n"));
  }

  if (missing.length > 0) {
    throw new Error(
      `[env] Required environment variables are missing:\n${missing.join("\n")}\n\n` +
        `Copy .env.example to .env.local and fill in the values.`
    );
  }
}

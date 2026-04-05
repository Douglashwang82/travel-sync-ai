/**
 * Environment variable validation.
 *
 * Call `validateEnv()` at the top of long-running server entry points
 * (e.g. the webhook handler on first request) to fail fast with a clear
 * error instead of a cryptic runtime crash later.
 *
 * Not called during build time — `!` assertions in other files handle that.
 */

interface EnvVar {
  key: string;
  required: boolean;
  description: string;
}

const SERVER_ENV_VARS: EnvVar[] = [
  { key: "LINE_CHANNEL_SECRET",           required: true,  description: "LINE channel secret for webhook signature verification" },
  { key: "LINE_CHANNEL_ACCESS_TOKEN",     required: true,  description: "LINE channel access token for sending messages" },
  { key: "NEXT_PUBLIC_SUPABASE_URL",      required: true,  description: "Supabase project URL" },
  { key: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", required: true, description: "Supabase anon/publishable key" },
  { key: "SUPABASE_SECRET_KEY",           required: true,  description: "Supabase service role key (server-side only)" },
  { key: "GEMINI_API_KEY",                required: true,  description: "Google Gemini API key for LLM parsing" },
  { key: "GOOGLE_PLACES_API_KEY",         required: false, description: "Google Places API key (optional — vote options fall back to manual if missing)" },
  { key: "NEXT_PUBLIC_LIFF_ID",           required: false, description: "LINE LIFF app ID (required for LIFF pages to work)" },
  { key: "CRON_SECRET",                   required: false, description: "Secret for Vercel cron route auth (required in production)" },
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
        missing.push(`  ❌ ${v.key} — ${v.description}`);
      } else {
        warnings.push(`  ⚠️  ${v.key} — ${v.description}`);
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

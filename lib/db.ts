import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Lazy singleton for browser (LIFF) client — respects Row Level Security
let _browserClient: SupabaseClient | null = null;
export function getSupabaseClient(): SupabaseClient {
  if (!_browserClient) {
    _browserClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || "",
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() || ""
    );
  }
  return _browserClient;
}

// Admin client factory for server-side use (webhook, API routes, background jobs) — bypasses RLS
// Replace with createClient<Database>(...) once `npx supabase gen types` has been run.
export function createAdminClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || "",
    process.env.SUPABASE_SECRET_KEY?.trim() || "",
    { auth: { persistSession: false } }
  );
}

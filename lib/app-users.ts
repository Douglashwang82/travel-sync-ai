import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/db";

/**
 * Helpers for the `app_users` identity table.
 *
 * Identity model:
 *   - LINE-authenticated users have `line_user_id` = their real LINE id (`U…`)
 *   - Email-registered users have `line_user_id` = `app_<uuid>` so all
 *     downstream tables that key on `line_user_id` keep working unchanged.
 */

export interface AppUserRow {
  id: string;
  email: string | null;
  display_name: string | null;
  line_user_id: string;
  password_hash: string | null;
  avatar_url: string | null;
}

export function generateSyntheticLineUserId(): string {
  return `app_${randomUUID().replace(/-/g, "")}`;
}

export function isSyntheticLineUserId(id: string): boolean {
  return id.startsWith("app_");
}

/**
 * Find or create an `app_users` row keyed by `line_user_id`. Used by the LINE
 * Login callback and the dev sign-in picker so that any identity that ends up
 * in the session cookie always has a corresponding `app_users` row.
 */
export async function ensureAppUserForLineId(
  lineUserId: string,
  fallbackDisplayName: string | null
): Promise<AppUserRow | null> {
  const db = createAdminClient();

  const { data: existing } = await db
    .from("app_users")
    .select("id, email, display_name, line_user_id, password_hash, avatar_url")
    .eq("line_user_id", lineUserId)
    .maybeSingle();

  if (existing) return existing as unknown as AppUserRow;

  const { data: created, error } = await db
    .from("app_users")
    .insert({
      line_user_id: lineUserId,
      display_name: fallbackDisplayName,
    })
    .select("id, email, display_name, line_user_id, password_hash, avatar_url")
    .single();

  if (error || !created) return null;
  return created as unknown as AppUserRow;
}

export async function findAppUserByEmail(
  email: string
): Promise<AppUserRow | null> {
  const db = createAdminClient();
  const { data } = await db
    .from("app_users")
    .select("id, email, display_name, line_user_id, password_hash, avatar_url")
    .ilike("email", email)
    .maybeSingle();
  return (data as unknown as AppUserRow | null) ?? null;
}

export async function findAppUserById(id: string): Promise<AppUserRow | null> {
  const db = createAdminClient();
  const { data } = await db
    .from("app_users")
    .select("id, email, display_name, line_user_id, password_hash, avatar_url")
    .eq("id", id)
    .maybeSingle();
  return (data as unknown as AppUserRow | null) ?? null;
}

import type { SupabaseClient } from "@supabase/supabase-js";

export async function validateActiveMember(
  db: SupabaseClient,
  groupId: string,
  lineUserId: string
): Promise<boolean> {
  const { data } = await db
    .from("group_members")
    .select("id")
    .eq("group_id", groupId)
    .eq("line_user_id", lineUserId)
    .is("left_at", null)
    .single();
  return data != null;
}

export async function getActiveMembers(
  db: SupabaseClient,
  groupId: string
): Promise<Array<{ line_user_id: string; display_name: string | null }>> {
  const { data } = await db
    .from("group_members")
    .select("line_user_id, display_name")
    .eq("group_id", groupId)
    .is("left_at", null);
  return (data ?? []) as Array<{ line_user_id: string; display_name: string | null }>;
}

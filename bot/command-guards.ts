import type { SupabaseClient } from "@supabase/supabase-js";

export type ActiveTrip = {
  id: string;
  destination_name?: string | null;
};

export type MatchableTripItem = {
  id: string;
  title: string;
  item_type?: string | null;
  item_kind?: string | null;
  stage?: string | null;
};

export async function getActiveTrip(
  db: SupabaseClient,
  dbGroupId: string,
  select = "id"
): Promise<ActiveTrip | null> {
  const { data } = await db
    .from("trips")
    .select(select)
    .eq("group_id", dbGroupId)
    .in("status", ["draft", "active"])
    .single();

  return (data as ActiveTrip | null) ?? null;
}

export function normalizeCommandMatch(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function findBestTripItemMatch<T extends MatchableTripItem>(
  items: T[] | null | undefined,
  query: string,
  preferredKind?: string
): T | null {
  const normalizedQuery = normalizeCommandMatch(query);
  if (!normalizedQuery) return null;

  const matches = (items ?? []).filter((item) => {
    const normalizedTitle = normalizeCommandMatch(item.title);
    return (
      normalizedTitle.includes(normalizedQuery) ||
      normalizedQuery.includes(normalizedTitle) ||
      normalizeCommandMatch(item.item_type ?? "") === normalizedQuery
    );
  });

  return (
    matches.sort((a, b) => {
      if (!preferredKind || a.item_kind === b.item_kind) return 0;
      return a.item_kind === preferredKind ? -1 : 1;
    })[0] ?? null
  );
}

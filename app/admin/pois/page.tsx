import Link from "next/link";
import { createAdminClient } from "@/lib/db";
import { POI_ITEM_TYPES, type PoiItemType } from "@/services/admin/poi-upsert";
import { PoisTable, type PoiRow } from "./pois-table";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ q?: string; item_type?: string; destination?: string; page?: string }>;
}

const PAGE_SIZE = 50;

async function loadPois(params: { q: string; itemType: string; destination: string; page: number }) {
  const db = createAdminClient();
  let query = db
    .from("poi_embeddings")
    .select("place_id, destination_name, destination_aliases, name, item_type, tags, description, lat, lng, source, last_seen_at", {
      count: "exact",
    });

  if (params.itemType && POI_ITEM_TYPES.includes(params.itemType as PoiItemType)) {
    query = query.eq("item_type", params.itemType);
  }
  if (params.destination) {
    query = query.ilike("destination_name", `%${params.destination}%`);
  }
  if (params.q) {
    const escaped = params.q.replace(/[%_]/g, (m) => `\\${m}`);
    query = query.or(`name.ilike.%${escaped}%,place_id.ilike.%${escaped}%`);
  }

  const from = (params.page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;
  const { data, count } = await query.order("last_seen_at", { ascending: false }).range(from, to);

  return {
    rows: ((data as PoiRow[] | null) ?? []),
    total: count ?? 0,
  };
}

export default async function PoisListPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const q = sp.q?.trim() ?? "";
  const itemType = sp.item_type?.trim() ?? "";
  const destination = sp.destination?.trim() ?? "";
  const page = Math.max(1, Number(sp.page ?? "1") || 1);
  const { rows, total } = await loadPois({ q, itemType, destination, page });
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">POIs</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            {total.toLocaleString()} POI{total === 1 ? "" : "s"} in the corpus.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/admin/pois/new"
            className="rounded-md border border-[var(--border)] px-4 py-2 text-sm hover:bg-[var(--secondary)]"
          >
            Add POI
          </Link>
          <Link
            href="/admin/pois/upload"
            className="rounded-md border border-[var(--border)] px-4 py-2 text-sm hover:bg-[var(--secondary)]"
          >
            Bulk upload
          </Link>
        </div>
      </header>

      <form className="flex flex-wrap items-end gap-2" method="GET">
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-[var(--muted-foreground)]">Search (name / place_id)</span>
          <input
            type="text"
            name="q"
            defaultValue={q}
            className="h-9 w-56 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm"
            placeholder="e.g. ramen, ChIJ..."
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-[var(--muted-foreground)]">Item type</span>
          <select
            name="item_type"
            defaultValue={itemType}
            className="h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 text-sm"
          >
            <option value="">All</option>
            {POI_ITEM_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-[var(--muted-foreground)]">Destination</span>
          <input
            type="text"
            name="destination"
            defaultValue={destination}
            className="h-9 w-48 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm"
            placeholder="e.g. Kyoto"
          />
        </label>
        <button
          type="submit"
          className="h-9 rounded-md bg-[var(--primary)] px-4 text-sm font-medium text-[var(--primary-foreground)] hover:opacity-90"
        >
          Search
        </button>
        {(q || itemType || destination) && (
          <Link href="/admin/pois" className="h-9 rounded-md px-3 text-sm leading-9 text-[var(--muted-foreground)] hover:underline">
            Clear
          </Link>
        )}
      </form>

      <PoisTable rows={rows} />

      {totalPages > 1 && (
        <nav className="flex items-center justify-between text-sm text-[var(--muted-foreground)]">
          <span>
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <Link
                className="rounded-md border border-[var(--border)] px-3 py-1.5 hover:bg-[var(--secondary)]"
                href={buildPageHref({ q, itemType, destination, page: page - 1 })}
              >
                ← Prev
              </Link>
            )}
            {page < totalPages && (
              <Link
                className="rounded-md border border-[var(--border)] px-3 py-1.5 hover:bg-[var(--secondary)]"
                href={buildPageHref({ q, itemType, destination, page: page + 1 })}
              >
                Next →
              </Link>
            )}
          </div>
        </nav>
      )}
    </div>
  );
}

function buildPageHref(p: { q: string; itemType: string; destination: string; page: number }): string {
  const sp = new URLSearchParams();
  if (p.q) sp.set("q", p.q);
  if (p.itemType) sp.set("item_type", p.itemType);
  if (p.destination) sp.set("destination", p.destination);
  if (p.page > 1) sp.set("page", String(p.page));
  const qs = sp.toString();
  return qs ? `/admin/pois?${qs}` : "/admin/pois";
}

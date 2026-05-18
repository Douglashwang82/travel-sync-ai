import Link from "next/link";
import { createAdminClient } from "@/lib/db";
import { POI_ITEM_TYPES } from "@/services/admin/poi-upsert";

export const dynamic = "force-dynamic";

async function loadCounts() {
  const db = createAdminClient();

  const [total, routes, ...byType] = await Promise.all([
    db.from("poi_embeddings").select("place_id", { count: "exact", head: true }),
    db.from("route_templates").select("id", { count: "exact", head: true }),
    ...POI_ITEM_TYPES.map((t) =>
      db.from("poi_embeddings").select("place_id", { count: "exact", head: true }).eq("item_type", t)
    ),
  ]);

  const destinationRes = await db.from("poi_embeddings").select("destination_name");
  const destinations = new Set<string>();
  for (const r of destinationRes.data ?? []) {
    const name = (r as { destination_name: string | null }).destination_name;
    if (name) destinations.add(name);
  }

  return {
    totalPois: total.count ?? 0,
    totalRoutes: routes.count ?? 0,
    totalDestinations: destinations.size,
    perType: Object.fromEntries(POI_ITEM_TYPES.map((t, i) => [t, byType[i].count ?? 0])),
  };
}

export default async function AdminOverviewPage() {
  const counts = await loadCounts();

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-2xl font-bold">Admin overview</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          Curate the POI corpus and route templates that power trip generation.
        </p>
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        <Stat label="POIs" value={counts.totalPois} href="/admin/pois" />
        <Stat label="Destinations" value={counts.totalDestinations} />
        <Stat label="Route templates" value={counts.totalRoutes} />
      </section>

      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
          POIs by type
        </h2>
        <div className="grid gap-2 sm:grid-cols-5">
          {POI_ITEM_TYPES.map((t) => (
            <Stat key={t} label={t} value={counts.perType[t] ?? 0} />
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
          Quick actions
        </h2>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/admin/pois/new"
            className="rounded-md border border-[var(--border)] px-4 py-2 text-sm hover:bg-[var(--secondary)]"
          >
            Add a POI
          </Link>
          <Link
            href="/admin/pois/upload"
            className="rounded-md border border-[var(--border)] px-4 py-2 text-sm hover:bg-[var(--secondary)]"
          >
            Bulk upload POIs
          </Link>
          <Link
            href="/admin/pois"
            className="rounded-md border border-[var(--border)] px-4 py-2 text-sm hover:bg-[var(--secondary)]"
          >
            Browse POIs
          </Link>
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value, href }: { label: string; value: number; href?: string }) {
  const body = (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-4">
      <div className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value.toLocaleString()}</div>
    </div>
  );
  if (href) {
    return (
      <Link href={href} className="block transition-colors hover:border-[var(--primary)]">
        {body}
      </Link>
    );
  }
  return body;
}

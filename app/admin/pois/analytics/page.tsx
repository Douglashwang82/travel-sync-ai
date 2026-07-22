import Link from "next/link";
import { createAdminClient } from "@/lib/db";
import {
  buildCorpusOverview,
  fetchPoiStats,
  fetchRankBucketStats,
  fetchTrendScores,
  MIN_EXPOSURES,
  type CorpusPoiRow,
  type GroupRollup,
  type RankedPoi,
} from "@/services/admin/poi-analytics";
import { CategorizeButton } from "./categorize-button";

export const dynamic = "force-dynamic";

// The corpus is hundreds of rows; paging would only complicate the rollups.
const MAX_CORPUS_ROWS = 5000;

async function loadOverview() {
  const db = createAdminClient();
  const [{ data: pois, error }, stats, trendScores, rankBuckets] = await Promise.all([
    db
      .from("poi_embeddings")
      .select("place_id, name, destination_name, item_type, source, category, labels, curation_status, quality_score")
      .limit(MAX_CORPUS_ROWS),
    fetchPoiStats(),
    fetchTrendScores(),
    fetchRankBucketStats(),
  ]);
  if (error) throw new Error(error.message);
  const overview = buildCorpusOverview((pois ?? []) as CorpusPoiRow[], stats, trendScores);
  return { overview, rankBuckets };
}

export default async function PoiAnalyticsPage() {
  const { overview, rankBuckets } = await loadOverview();

  return (
    <div className="space-y-8">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">POI ranking analytics</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            Exposure and selection signals from itinerary_feedback, social trend scores, and curation coverage —
            the raw material for designing the ranking algorithm.
          </p>
        </div>
        <CategorizeButton uncategorized={overview.uncategorized} />
      </header>

      {/* ─── Headline cards ─────────────────────────────────────────────── */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="POIs in corpus" value={overview.totalPois.toLocaleString()} />
        <StatCard label="Uncategorized" value={overview.uncategorized.toLocaleString()} />
        <StatCard
          label="Avg similarity · picked"
          value={overview.similaritySplit.selected != null ? overview.similaritySplit.selected.toFixed(3) : "—"}
        />
        <StatCard
          label="Avg similarity · rejected"
          value={overview.similaritySplit.rejected != null ? overview.similaritySplit.rejected.toFixed(3) : "—"}
        />
      </section>
      <p className="text-xs text-[var(--muted-foreground)]">
        If picked and rejected similarities are close, cosine similarity alone is a weak ranking feature — lean on
        selection rate, trend score, quality priors and category fit instead.
      </p>

      {/* ─── Rank-bucket curve ──────────────────────────────────────────── */}
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Selection rate by shortlist rank</h2>
        <p className="text-xs text-[var(--muted-foreground)]">
          How often the LLM picks a candidate by its vector-search position (5-wide buckets). A steep drop means
          retrieval order strongly shapes outcomes; a flat curve means the LLM re-decides regardless of rank.
        </p>
        {rankBuckets.length === 0 ? (
          <Empty text="No feedback rows yet — run some generations first." />
        ) : (
          <table className="w-full max-w-xl text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
              <tr>
                <th className="py-1 pr-3">Rank</th>
                <th className="py-1 pr-3">Exposures</th>
                <th className="py-1 pr-3">Picked</th>
                <th className="py-1">Rate</th>
              </tr>
            </thead>
            <tbody>
              {rankBuckets.map((b) => (
                <tr key={b.bucket_start} className="border-t border-[var(--border)]">
                  <td className="py-1.5 pr-3 font-mono text-xs">
                    {b.bucket_start}–{b.bucket_start + 4}
                  </td>
                  <td className="py-1.5 pr-3">{b.exposures}</td>
                  <td className="py-1.5 pr-3">{b.selections}</td>
                  <td className="py-1.5">
                    <RateBar rate={b.selection_rate} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* ─── Rollups ─────────────────────────────────────────────────────── */}
      <section className="grid gap-6 lg:grid-cols-2">
        <RollupTable title="By category" note="(uncategorized) rows dilute any category feature — label them." rows={overview.byCategory} />
        <RollupTable title="By source" note="Compares curated, Google-seeded and social_trending supply." rows={overview.bySource} />
        <RollupTable title="By curation status" note="hidden POIs are excluded from retrieval." rows={overview.byStatus} />
        <RollupTable title="By destination" note="Coverage and demand per destination." rows={overview.byDestination} />
      </section>

      {/* ─── Ranked lists ───────────────────────────────────────────────── */}
      <section className="grid gap-6 lg:grid-cols-3">
        <RankedList
          title="Top performers"
          note={`≥${MIN_EXPOSURES} exposures, best pick rate — boost candidates.`}
          rows={overview.topPerformers}
        />
        <RankedList
          title="Underperformers"
          note={`≥${MIN_EXPOSURES} exposures, worst pick rate — demote or hide.`}
          rows={overview.underperformers}
        />
        <RankedList
          title="Trending but never shortlisted"
          note="Live social buzz that retrieval isn't surfacing — check tags/description."
          rows={overview.trendingUnexposed}
        />
      </section>

      <p className="text-xs text-[var(--muted-foreground)]">
        Labels, categories, status and quality scores are edited inline on the{" "}
        <Link href="/admin/pois" className="underline">
          POIs list
        </Link>
        . All aggregates come from live tables; refresh after curating.
      </p>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--border)] p-4">
      <div className="text-xs text-[var(--muted-foreground)]">{label}</div>
      <div className="mt-1 text-2xl font-bold">{value}</div>
    </div>
  );
}

function RateBar({ rate }: { rate: number }) {
  return (
    <span className="flex items-center gap-2">
      <span className="h-2 w-28 overflow-hidden rounded-full bg-[var(--secondary)]">
        <span className="block h-full bg-[var(--primary)]" style={{ width: `${Math.round(rate * 100)}%` }} />
      </span>
      <span className="text-xs">{Math.round(rate * 100)}%</span>
    </span>
  );
}

function RollupTable({ title, note, rows }: { title: string; note: string; rows: GroupRollup[] }) {
  return (
    <div className="space-y-2">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="text-xs text-[var(--muted-foreground)]">{note}</p>
      {rows.length === 0 ? (
        <Empty text="No rows." />
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
            <tr>
              <th className="py-1 pr-3">Group</th>
              <th className="py-1 pr-3">POIs</th>
              <th className="py-1 pr-3">Exposures</th>
              <th className="py-1">Pick rate</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 12).map((r) => (
              <tr key={r.key} className="border-t border-[var(--border)]">
                <td className="max-w-[180px] truncate py-1.5 pr-3" title={r.key}>
                  {r.key}
                </td>
                <td className="py-1.5 pr-3">{r.pois}</td>
                <td className="py-1.5 pr-3">{r.exposures}</td>
                <td className="py-1.5">{r.selectionRate != null ? <RateBar rate={r.selectionRate} /> : <span className="text-xs text-[var(--muted-foreground)]">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function RankedList({ title, note, rows }: { title: string; note: string; rows: RankedPoi[] }) {
  return (
    <div className="space-y-2">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="text-xs text-[var(--muted-foreground)]">{note}</p>
      {rows.length === 0 ? (
        <Empty text="Nothing here yet." />
      ) : (
        <ul className="space-y-1.5">
          {rows.map((r) => (
            <li key={r.placeId} className="rounded-md border border-[var(--border)] px-3 py-2 text-sm">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate font-medium" title={r.name}>
                  {r.name}
                </span>
                <span className="shrink-0 text-xs text-[var(--muted-foreground)]">
                  {r.exposures > 0 ? `${Math.round(r.selectionRate * 100)}% · ${r.exposures}×` : `🔥 ${r.trendScore.toFixed(2)}`}
                </span>
              </div>
              <div className="mt-0.5 text-xs text-[var(--muted-foreground)]">
                {r.destination}
                {r.category ? ` · ${r.category}` : ""}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-dashed border-[var(--border)] p-6 text-center text-sm text-[var(--muted-foreground)]">
      {text}
    </div>
  );
}

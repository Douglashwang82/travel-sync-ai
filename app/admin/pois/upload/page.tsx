import { BulkUploadForm } from "./bulk-upload-form";

export const dynamic = "force-dynamic";

const JSON_EXAMPLE = `[
  {
    "place_id": "local:kyoto/kennin-ji",
    "destination_name": "Kyoto, Japan",
    "destination_aliases": ["kyoto", "京都"],
    "name": "Kennin-ji Temple",
    "item_type": "activity",
    "tags": ["temple", "culture", "zen"],
    "description": "Zen temple in Higashiyama with dragon ceiling and rock gardens.",
    "lat": 35.0036,
    "lng": 135.7741
  }
]`;

const CSV_EXAMPLE = `place_id,destination_name,destination_aliases,name,item_type,tags,description,lat,lng
local:kyoto/kennin-ji,"Kyoto, Japan",kyoto|京都,Kennin-ji Temple,activity,temple|culture|zen,Zen temple in Higashiyama,35.0036,135.7741`;

export default function BulkUploadPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Bulk upload POIs</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          Paste or drop a JSON array (max 500 items) or a CSV file. Each item is upserted by{" "}
          <code>place_id</code>; an embedding is generated per row.
        </p>
      </header>

      <BulkUploadForm />

      <section className="grid gap-4 md:grid-cols-2">
        <Example title="JSON shape" body={JSON_EXAMPLE} />
        <Example title="CSV shape" body={CSV_EXAMPLE} hint="Use | (pipe) to separate tags and aliases inside a CSV cell." />
      </section>
    </div>
  );
}

function Example({ title, body, hint }: { title: string; body: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-4">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">{title}</div>
      <pre className="overflow-x-auto rounded bg-[var(--secondary)]/40 p-3 text-[11px] leading-relaxed">{body}</pre>
      {hint && <p className="mt-2 text-[11px] text-[var(--muted-foreground)]">{hint}</p>}
    </div>
  );
}

import { NewPoiForm } from "./new-poi-form";

export const dynamic = "force-dynamic";

export default function NewPoiPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Add a POI</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          Generates a 768-dim embedding via Gemini and upserts into <code>poi_embeddings</code>.
        </p>
      </header>
      <NewPoiForm />
    </div>
  );
}

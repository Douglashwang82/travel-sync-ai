"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface BulkResultRow {
  place_id: string;
  ok: boolean;
  error?: string;
}

interface BulkSummary {
  total: number;
  succeeded: number;
  failed: number;
  results: BulkResultRow[];
}

type Mode = "json" | "csv";

export function BulkUploadForm() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("json");
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<BulkSummary | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function loadFile(file: File) {
    setError(null);
    setFileName(file.name);
    const lower = file.name.toLowerCase();
    if (lower.endsWith(".csv")) setMode("csv");
    else if (lower.endsWith(".json")) setMode("json");
    setText(await file.text());
  }

  async function submit() {
    setError(null);
    setSummary(null);

    if (!text.trim()) {
      setError("Paste content or pick a file first.");
      return;
    }

    setBusy(true);
    try {
      const headers: Record<string, string> = {
        "content-type": mode === "csv" ? "text/csv" : "application/json",
      };
      let body: string = text;
      if (mode === "json") {
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch (err) {
          throw new Error(`Invalid JSON: ${err instanceof Error ? err.message : String(err)}`);
        }
        body = JSON.stringify(parsed);
      }
      const res = await fetch("/api/admin/pois/bulk", { method: "POST", headers, body });
      const result = (await res.json().catch(() => ({}))) as Partial<BulkSummary> & { error?: string };
      if (!res.ok) throw new Error(result.error ?? `request failed (${res.status})`);
      setSummary({
        total: result.total ?? 0,
        succeeded: result.succeeded ?? 0,
        failed: result.failed ?? 0,
        results: result.results ?? [],
      });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setText("");
    setFileName(null);
    setSummary(null);
    setError(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <fieldset className="inline-flex overflow-hidden rounded-md border border-[var(--border)] text-sm">
          {(["json", "csv"] as const).map((m) => (
            <label
              key={m}
              className={`cursor-pointer px-3 py-1.5 ${
                mode === m ? "bg-[var(--primary)] text-[var(--primary-foreground)]" : "hover:bg-[var(--secondary)]"
              }`}
            >
              <input type="radio" name="mode" value={m} className="sr-only" checked={mode === m} onChange={() => setMode(m)} />
              {m.toUpperCase()}
            </label>
          ))}
        </fieldset>

        <label className="cursor-pointer rounded-md border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[var(--secondary)]">
          <input
            ref={fileRef}
            type="file"
            className="sr-only"
            accept=".json,.csv,application/json,text/csv"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void loadFile(f);
            }}
          />
          Choose file
        </label>
        {fileName && (
          <span className="text-xs text-[var(--muted-foreground)]">
            {fileName} ({Math.ceil(text.length / 1024)} KB)
          </span>
        )}
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={14}
        spellCheck={false}
        className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 font-mono text-xs"
        placeholder={mode === "json" ? "Paste a JSON array here…" : "Paste CSV here (first row = headers)…"}
      />

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-700 dark:bg-red-950/50 dark:text-red-200">
          {error}
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="rounded-md bg-[var(--primary)] px-5 py-2 text-sm font-medium text-[var(--primary-foreground)] hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "Uploading…" : "Upload"}
        </button>
        <button
          type="button"
          onClick={reset}
          disabled={busy}
          className="rounded-md border border-[var(--border)] px-3 py-2 text-sm hover:bg-[var(--secondary)]"
        >
          Reset
        </button>
        <span className="text-xs text-[var(--muted-foreground)]">
          Embedding is generated per row — large batches may take a while.
        </span>
      </div>

      {summary && <SummaryBlock summary={summary} />}
    </div>
  );
}

function SummaryBlock({ summary }: { summary: BulkSummary }) {
  const failed = summary.results.filter((r) => !r.ok);
  return (
    <div className="space-y-2 rounded-lg border border-[var(--border)] bg-[var(--background)] p-4">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="font-semibold">{summary.total} processed</span>
        <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-800 dark:bg-green-950/40 dark:text-green-200">
          {summary.succeeded} succeeded
        </span>
        {summary.failed > 0 && (
          <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-800 dark:bg-red-950/40 dark:text-red-200">
            {summary.failed} failed
          </span>
        )}
      </div>
      {failed.length > 0 && (
        <div className="mt-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
            Failures
          </div>
          <ul className="mt-1 max-h-60 overflow-auto text-xs">
            {failed.map((r, i) => (
              <li key={`${r.place_id}-${i}`} className="border-b border-[var(--border)] py-1 last:border-0">
                <code className="font-mono">{r.place_id}</code>: {r.error ?? "unknown error"}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

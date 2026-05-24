import { cookies } from "next/headers";
import { parseAppLocale } from "@/lib/app-locale";
import { loadApiEndpoints, type ApiEndpoint, type HttpMethod } from "@/lib/docs/api-parser";
import { loadSchema, type SchemaTable } from "@/lib/docs/schema-parser";
import { getDocsCopy, type DocsCopy } from "@/lib/docs/copy";
import { DocsToc, type DocsTocItem } from "@/components/app/docs-toc";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "TravelSync — Documentation",
  description: "API reference, database schema, user guide and architecture documentation.",
};

const METHOD_STYLES: Record<HttpMethod, string> = {
  GET: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200",
  POST: "bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-200",
  PUT: "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-200",
  PATCH: "bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-200",
  DELETE: "bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-200",
  OPTIONS: "bg-slate-100 text-slate-800 dark:bg-slate-900 dark:text-slate-200",
  HEAD: "bg-slate-100 text-slate-800 dark:bg-slate-900 dark:text-slate-200",
};

export default async function DocsPage() {
  const locale = parseAppLocale((await cookies()).get("travelsync-app-locale")?.value);
  const copy = getDocsCopy(locale);
  const [apiGroups, tables] = await Promise.all([loadApiEndpoints(), loadSchema()]);

  const tocItems: DocsTocItem[] = [
    {
      id: "section-api",
      label: copy.sections.api,
      children: apiGroups.map((g) => ({ id: `group-${g.slug}`, label: g.label })),
    },
    {
      id: "section-schema",
      label: copy.sections.schema,
    },
    {
      id: "section-guide",
      label: copy.sections.guide,
      children: copy.guide.sections.map((s) => ({ id: s.id, label: s.title })),
    },
    {
      id: "section-sad",
      label: copy.sections.sad,
      children: copy.sad.sections.map((s) => ({ id: s.id, label: s.title })),
    },
  ];

  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_220px]">
      <article className="min-w-0 space-y-12 scroll-smooth">
        <header>
          <h1 className="text-2xl font-bold text-[var(--foreground)]">{copy.pageTitle}</h1>
          <p className="mt-2 max-w-2xl text-sm text-[var(--muted-foreground)]">{copy.pageSubtitle}</p>
        </header>

        <ApiSection copy={copy} apiGroups={apiGroups} />
        <SchemaSection copy={copy} tables={tables} />
        <GuideSection copy={copy} />
        <SadSection copy={copy} />
      </article>

      <aside className="order-first lg:order-last">
        <DocsToc title={copy.tocTitle} items={tocItems} />
      </aside>
    </div>
  );
}

function ApiSection({
  copy,
  apiGroups,
}: {
  copy: DocsCopy;
  apiGroups: Awaited<ReturnType<typeof loadApiEndpoints>>;
}) {
  return (
    <section id="section-api" className="scroll-mt-20 space-y-6">
      <SectionHeading number="01" title={copy.sections.api} description={copy.api.intro} />
      <div className="space-y-8">
        {apiGroups.map((group) => (
          <div key={group.slug} id={`group-${group.slug}`} className="scroll-mt-20">
            <h3 className="mb-3 text-sm font-semibold text-[var(--foreground)]">
              {group.label}
              <span className="ml-2 text-xs font-normal text-[var(--muted-foreground)]">
                ({group.endpoints.length})
              </span>
            </h3>
            <div className="overflow-hidden rounded-2xl border border-[var(--border)]">
              <table className="w-full border-collapse text-left text-xs">
                <thead className="bg-[var(--secondary)]/40 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                  <tr>
                    <th className="px-3 py-2">{copy.api.methodHeading}</th>
                    <th className="px-3 py-2">{copy.api.pathHeading}</th>
                    <th className="px-3 py-2">{copy.api.descHeading}</th>
                    <th className="px-3 py-2">{copy.api.sourceHeading}</th>
                  </tr>
                </thead>
                <tbody>
                  {group.endpoints.map((ep) => (
                    <EndpointRow key={ep.source} endpoint={ep} copy={copy} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function EndpointRow({ endpoint, copy }: { endpoint: ApiEndpoint; copy: DocsCopy }) {
  return (
    <tr className="border-t border-[var(--border)] align-top">
      <td className="px-3 py-2">
        <div className="flex flex-wrap gap-1">
          {endpoint.methods.map((m) => (
            <span
              key={m}
              className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${METHOD_STYLES[m]}`}
            >
              {m}
            </span>
          ))}
        </div>
      </td>
      <td className="px-3 py-2">
        <code className="font-mono text-[11px] text-[var(--foreground)]">{endpoint.pattern}</code>
        <div className="mt-1 flex flex-wrap gap-1">
          {endpoint.hasZodSchema && (
            <span className="rounded bg-[var(--secondary)] px-1 py-0.5 text-[10px] text-[var(--muted-foreground)]">
              {copy.api.zodBadge}
            </span>
          )}
          {endpoint.isCronAuthed && (
            <span className="rounded bg-[var(--secondary)] px-1 py-0.5 text-[10px] text-[var(--muted-foreground)]">
              {copy.api.cronBadge}
            </span>
          )}
        </div>
      </td>
      <td className="px-3 py-2 text-[var(--muted-foreground)]">
        {endpoint.summary ?? copy.api.noDescription}
      </td>
      <td className="px-3 py-2">
        <code className="font-mono text-[10px] text-[var(--muted-foreground)]">
          {endpoint.source}
        </code>
      </td>
    </tr>
  );
}

function SchemaSection({ copy, tables }: { copy: DocsCopy; tables: SchemaTable[] }) {
  return (
    <section id="section-schema" className="scroll-mt-20 space-y-6">
      <SectionHeading number="02" title={copy.sections.schema} description={copy.schema.intro} />
      <div className="grid gap-4 md:grid-cols-2">
        {tables.map((table) => (
          <TableCard key={table.name} table={table} copy={copy} />
        ))}
      </div>
    </section>
  );
}

function TableCard({ table, copy }: { table: SchemaTable; copy: DocsCopy }) {
  return (
    <div
      id={`table-${table.name}`}
      className="scroll-mt-20 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--background)]"
    >
      <div className="border-b border-[var(--border)] bg-[var(--secondary)]/40 px-4 py-2">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="font-mono text-sm font-semibold text-[var(--foreground)]">{table.name}</h3>
          <span className="text-[10px] text-[var(--muted-foreground)]">
            {copy.schema.columnCount(table.columns.length)}
          </span>
        </div>
        <p className="mt-0.5 text-[10px] text-[var(--muted-foreground)]">
          {copy.schema.createdIn}{" "}
          <code className="font-mono">{table.createdIn}</code>
        </p>
      </div>
      <div className="max-h-80 overflow-y-auto">
        <table className="w-full border-collapse text-left text-xs">
          <thead className="sticky top-0 bg-[var(--background)] text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
            <tr>
              <th className="px-3 py-1.5">{copy.schema.columnHeading}</th>
              <th className="px-3 py-1.5">{copy.schema.typeHeading}</th>
              <th className="px-3 py-1.5">{copy.schema.modifiersHeading}</th>
            </tr>
          </thead>
          <tbody>
            {table.columns.map((col) => (
              <tr key={col.name} className="border-t border-[var(--border)] align-top">
                <td className="px-3 py-1.5 font-mono text-[11px] text-[var(--foreground)]">
                  {col.name}
                </td>
                <td className="px-3 py-1.5 font-mono text-[11px] text-[var(--muted-foreground)]">
                  {col.type}
                </td>
                <td className="px-3 py-1.5">
                  <div className="flex flex-wrap gap-1">
                    {col.modifiers.map((m, i) => (
                      <span
                        key={`${m}-${i}`}
                        className="rounded bg-[var(--secondary)] px-1 py-0.5 font-mono text-[10px] text-[var(--muted-foreground)]"
                      >
                        {m}
                      </span>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function GuideSection({ copy }: { copy: DocsCopy }) {
  return (
    <section id="section-guide" className="scroll-mt-20 space-y-6">
      <SectionHeading number="03" title={copy.sections.guide} description={copy.guide.intro} />
      <div className="space-y-8">
        {copy.guide.sections.map((s) => (
          <div key={s.id} id={s.id} className="scroll-mt-20">
            <h3 className="mb-2 text-base font-semibold text-[var(--foreground)]">{s.title}</h3>
            <div className="space-y-2 text-sm leading-relaxed text-[var(--muted-foreground)]">
              {s.body.map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function SadSection({ copy }: { copy: DocsCopy }) {
  return (
    <section id="section-sad" className="scroll-mt-20 space-y-6">
      <SectionHeading number="04" title={copy.sections.sad} description={copy.sad.intro} />
      <div className="space-y-8">
        {copy.sad.sections.map((s) => (
          <div key={s.id} id={s.id} className="scroll-mt-20">
            <h3 className="mb-2 text-base font-semibold text-[var(--foreground)]">{s.title}</h3>
            <div className="space-y-2 text-sm leading-relaxed text-[var(--muted-foreground)]">
              {s.body.map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </div>
            {s.diagram && (
              <pre className="mt-3 overflow-x-auto rounded-2xl border border-[var(--border)] bg-[var(--secondary)]/40 p-4 font-mono text-[11px] leading-relaxed text-[var(--foreground)]">
                {s.diagram}
              </pre>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function SectionHeading({
  number,
  title,
  description,
}: {
  number: string;
  title: string;
  description: string;
}) {
  return (
    <div className="border-b border-[var(--border)] pb-4">
      <div className="flex items-baseline gap-3">
        <span className="font-mono text-xs text-[var(--muted-foreground)]">{number}</span>
        <h2 className="text-xl font-bold text-[var(--foreground)]">{title}</h2>
      </div>
      <p className="mt-2 max-w-3xl text-sm text-[var(--muted-foreground)]">{description}</p>
    </div>
  );
}

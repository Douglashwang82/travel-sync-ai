export default function ReadinessPage() {
  return (
    <div className="max-w-md mx-auto px-4 py-6 space-y-4">
      <header className="space-y-1">
        <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
          TravelSync AI v1.2
        </p>
        <h1 className="text-2xl font-semibold text-[var(--foreground)]">
          Readiness Checklist
        </h1>
        <p className="text-sm text-[var(--muted-foreground)]">
          Scaffolded page for pre-departure and return-home operational checks.
        </p>
      </header>

      <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 space-y-3">
        <h2 className="font-medium text-[var(--foreground)]">Planned sections</h2>
        <ul className="text-sm text-[var(--muted-foreground)] space-y-2 list-disc pl-5">
          <li>Checklist categories and completion progress</li>
          <li>Critical blockers and overdue items</li>
          <li>Member-level confirmations</li>
          <li>Manual organizer overrides</li>
        </ul>
      </section>
    </div>
  );
}

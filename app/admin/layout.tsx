import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";

export const metadata = {
  title: "TravelSync — Admin",
  robots: { index: false, follow: false },
};

const NAV = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/pois", label: "POIs" },
  { href: "/admin/pois/analytics", label: "Analytics" },
  { href: "/admin/pois/new", label: "Add POI" },
  { href: "/admin/pois/upload", label: "Bulk upload" },
];

export default function AdminLayout({ children }: { children: ReactNode }) {
  if (process.env.ADMIN_BOARD_ENABLED !== "true") {
    notFound();
  }

  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <header className="border-b border-[var(--border)] bg-[var(--background)]">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <Link href="/admin" className="text-sm font-semibold">
            TravelSync · Admin
          </Link>
          <nav className="flex flex-wrap items-center gap-1 text-xs">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-md px-3 py-1.5 text-[var(--muted-foreground)] hover:bg-[var(--secondary)] hover:text-[var(--foreground)]"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}

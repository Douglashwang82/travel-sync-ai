"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export interface DocsTocItem {
  id: string;
  label: string;
  children?: DocsTocItem[];
}

export function DocsToc({ title, items }: { title: string; items: DocsTocItem[] }) {
  const [activeId, setActiveId] = useState<string | null>(items[0]?.id ?? null);

  useEffect(() => {
    const headings = items
      .flatMap((item) => [item, ...(item.children ?? [])])
      .map((item) => document.getElementById(item.id))
      .filter((el): el is HTMLElement => Boolean(el));
    if (headings.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        // Pick the topmost heading currently intersecting the viewport.
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, z) => a.boundingClientRect.top - z.boundingClientRect.top);
        if (visible[0]) setActiveId(visible[0].target.id);
      },
      { rootMargin: "-80px 0px -70% 0px", threshold: [0, 1] },
    );

    for (const el of headings) observer.observe(el);
    return () => observer.disconnect();
  }, [items]);

  return (
    <nav
      id="docs-toc"
      aria-label={title}
      className="hidden lg:block sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto"
    >
      <p className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
        {title}
      </p>
      <ul className="space-y-1 border-l border-[var(--border)]">
        {items.map((item) => (
          <li key={item.id}>
            <a
              href={`#${item.id}`}
              className={cn(
                "block border-l-2 -ml-px px-3 py-1 text-sm transition-colors",
                activeId === item.id
                  ? "border-[var(--primary)] font-semibold text-[var(--primary)]"
                  : "border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
              )}
            >
              {item.label}
            </a>
            {item.children && item.children.length > 0 && (
              <ul className="ml-3 space-y-1">
                {item.children.map((child) => (
                  <li key={child.id}>
                    <a
                      href={`#${child.id}`}
                      className={cn(
                        "block border-l-2 -ml-px px-3 py-0.5 text-xs transition-colors",
                        activeId === child.id
                          ? "border-[var(--primary)] font-medium text-[var(--primary)]"
                          : "border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
                      )}
                    >
                      {child.label}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}

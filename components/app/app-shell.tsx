"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { AppSidebar } from "@/components/app/app-sidebar";

export function AppShell({
  user,
  children,
}: {
  user: { lineUserId: string; displayName: string | null } | null;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div
      id="app-shell"
      className="min-h-screen bg-[var(--secondary)]/40 dark:bg-[#0a0a0a]"
    >
      <AppSidebar
        user={user}
        collapsed={collapsed}
        onCollapse={() => setCollapsed((v) => !v)}
      />

      <div
        id="app-content"
        className={cn(
          "flex flex-col transition-[padding-left] duration-300 ease-in-out",
          collapsed ? "lg:pl-14" : "lg:pl-56"
        )}
      >
        <main
          id="app-main"
          className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8"
        >
          {children}
        </main>
      </div>
    </div>
  );
}

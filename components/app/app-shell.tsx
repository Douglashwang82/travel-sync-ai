"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import { usePathname } from "next/navigation";
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
  const pathname = usePathname();
  const isTripWorkspace = pathname?.startsWith("/app/trips/");

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
          collapsed ? "lg:pl-14" : "lg:pl-56",
          isTripWorkspace && "lg:pr-72",
        )}
      >
        <main
          id="app-main"
          className={cn(
            "mx-auto w-full px-4 py-6 sm:px-6 sm:py-8",
            isTripWorkspace ? "md:max-w-none lg:px-8 2xl:px-10" : "max-w-6xl"
          )}
        >
          {children}
        </main>
      </div>
    </div>
  );
}

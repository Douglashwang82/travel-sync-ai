"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { AppSidebar } from "@/components/app/app-sidebar";
import { pageTransition } from "@/components/motion/variants";

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
  const isFullBleed = pathname === "/app/map";

  return (
    <div
      id="app-shell"
      className="relative min-h-screen bg-[var(--surface-base)]"
    >

      <AppSidebar
        user={user}
        collapsed={collapsed}
        onCollapse={() => setCollapsed((v) => !v)}
      />

      <div
        id="app-content"
        className={cn(
          "relative z-10 flex flex-col transition-[padding-left] duration-300 ease-in-out",
          collapsed ? "lg:pl-14" : "lg:pl-56",
          isTripWorkspace && "lg:pr-72",
        )}
      >
        <main
          id="app-main"
          className={cn(
            "w-full",
            isFullBleed
              ? "h-[calc(100dvh-3rem)] max-w-none p-0 lg:h-screen"
              : cn(
                  "mx-auto px-4 py-6 sm:px-6 sm:py-8",
                  isTripWorkspace ? "md:max-w-none lg:px-8 2xl:px-10" : "max-w-6xl"
                )
          )}
        >
          {isFullBleed ? (
            children
          ) : (
            <motion.div
              key={pathname}
              variants={pageTransition}
              initial="hidden"
              animate="show"
            >
              {children}
            </motion.div>
          )}
        </main>
      </div>
    </div>
  );
}

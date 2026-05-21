"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useAppLocale } from "@/components/app/app-locale-provider";
import { AppLanguageToggle } from "@/components/app/app-language-toggle";
import { AppHeaderUser } from "@/components/app/app-header-user";
import { InboxNavLink } from "@/components/app/inbox-nav-link";
import { cn } from "@/lib/utils";

const COPY = {
  en: {
    workspace: "Workspace",
    trips: "Trips",
    templates: "Templates",
    profile: "Profile",
    home: "Home",
    openMenu: "Open menu",
    closeMenu: "Close menu",
    collapseSidebar: "Collapse sidebar",
    expandSidebar: "Expand sidebar",
  },
  "zh-TW": {
    workspace: "工作區",
    trips: "旅程",
    templates: "範本",
    profile: "個人檔案",
    home: "首頁",
    openMenu: "開啟選單",
    closeMenu: "關閉選單",
    collapseSidebar: "收合側邊欄",
    expandSidebar: "展開側邊欄",
  },
} as const;

const NAV_ITEMS = [
  { key: "trips" as const, href: "/app", icon: "✈" },
  { key: "templates" as const, href: "/app/templates", icon: "📋" },
  { key: "profile" as const, href: "/app/profile", icon: "👤", requiresUser: true },
  { key: "home" as const, href: "/", icon: "🏠" },
] as const;

export function AppSidebar({
  user,
  collapsed = false,
  onCollapse,
}: {
  user: { lineUserId: string; displayName: string | null } | null;
  collapsed?: boolean;
  onCollapse?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const { locale } = useAppLocale();
  const copy = COPY[locale];

  // Close drawer on route change
  useEffect(() => {
    const handle = window.setTimeout(() => setOpen(false), 0);
    return () => window.clearTimeout(handle);
  }, [pathname]);

  // Lock body scroll while drawer is open
  useEffect(() => {
    if (open) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  function isActive(href: string) {
    if (href === "/app") return pathname === "/app" || pathname.startsWith("/app/trips");
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  }

  const navItems = NAV_ITEMS.filter(
    (item) => !("requiresUser" in item && item.requiresUser) || Boolean(user),
  );

  const sidebarContent = (
    <div id="sidebar-inner" className="flex h-full flex-col overflow-hidden">
      {/* Brand */}
      <div
        id="sidebar-brand"
        className={cn(
          "flex flex-shrink-0 items-center border-b border-[var(--border)] py-4",
          collapsed ? "justify-center px-0" : "justify-between gap-3 px-4"
        )}
      >
        {collapsed && onCollapse ? (
          <button
            id="sidebar-collapse-btn"
            type="button"
            aria-label={copy.expandSidebar}
            onClick={onCollapse}
            className="hidden h-7 w-7 items-center justify-center rounded-lg text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)] hover:text-[var(--foreground)] lg:inline-flex"
          >
            <ChevronRight aria-hidden size={14} strokeWidth={2.25} />
          </button>
        ) : (
          <Link
            id="sidebar-logo"
            href="/app"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 text-sm font-bold tracking-tight text-[var(--foreground)]"
          >
            <Image
              src="/logo.png"
              alt=""
              width={28}
              height={28}
              className="h-7 w-auto logo-animated flex-shrink-0"
              priority
            />
            <div className="min-w-0">
              <span className="text-[var(--primary)]">TravelSync</span>
              <p className="text-[10px] font-normal text-[var(--muted-foreground)]">{copy.workspace}</p>
            </div>
          </Link>
        )}

        {onCollapse && !collapsed && (
          <button
            id="sidebar-collapse-btn"
            type="button"
            aria-label={copy.collapseSidebar}
            onClick={onCollapse}
            className="hidden h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)] hover:text-[var(--foreground)] lg:inline-flex"
          >
            <ChevronLeft aria-hidden size={14} strokeWidth={2.25} />
          </button>
        )}
      </div>

      {/* Primary nav */}
      <nav id="sidebar-nav" className="flex-1 overflow-y-auto py-4" style={{ padding: collapsed ? "1rem 0" : undefined }}>
        <ul id="sidebar-nav-list" className={cn("space-y-0.5", collapsed ? "px-1" : "px-3")}>
          {navItems.map(({ key, href, icon }) => (
            <li key={href}>
              <Link
                id={`sidebar-nav-${key}`}
                href={href}
                onClick={() => setOpen(false)}
                title={collapsed ? copy[key] : undefined}
                className={cn(
                  "flex items-center rounded-xl py-2.5 text-sm transition-colors",
                  collapsed ? "justify-center px-0" : "gap-3 px-3",
                  isActive(href)
                    ? "bg-[var(--primary)]/10 font-semibold text-[var(--primary)]"
                    : "text-[var(--muted-foreground)] hover:bg-[var(--secondary)] hover:text-[var(--foreground)]"
                )}
              >
                <span aria-hidden className="w-5 text-center text-base leading-none">
                  {icon}
                </span>
                {!collapsed && copy[key]}
              </Link>
            </li>
          ))}

          {user && (
            <li id="sidebar-nav-inbox">
              <div
                onClick={() => setOpen(false)}
                title={collapsed ? "Inbox" : undefined}
                className={cn(
                  "flex items-center rounded-xl py-2.5 text-sm transition-colors",
                  collapsed ? "justify-center px-0" : "gap-3 px-3",
                  pathname === "/app/inbox"
                    ? "bg-[var(--primary)]/10 font-semibold text-[var(--primary)]"
                    : "text-[var(--muted-foreground)] hover:bg-[var(--secondary)] hover:text-[var(--foreground)]"
                )}
              >
                <span aria-hidden className="w-5 text-center text-base leading-none">✉</span>
                {!collapsed && <InboxNavLink />}
              </div>
            </li>
          )}
        </ul>
      </nav>

      {/* Footer: language + user (hidden when collapsed) */}
      {!collapsed && (
        <div id="sidebar-footer" className="flex-shrink-0 space-y-3 border-t border-[var(--border)] px-4 py-4">
          <AppLanguageToggle />
          <AppHeaderUser user={user} />
        </div>
      )}
    </div>
  );

  return (
    <>
      {/* ── Desktop fixed sidebar ─────────────────────────────────── */}
      <aside
        id="app-sidebar"
        className={cn(
          "hidden lg:flex lg:fixed lg:inset-y-0 lg:left-0 lg:z-30 lg:flex-col border-r border-[var(--border)] bg-[var(--background)] transition-[width] duration-300 ease-in-out",
          collapsed ? "lg:w-14" : "lg:w-56"
        )}
      >
        {sidebarContent}
      </aside>

      {/* ── Mobile top bar ────────────────────────────────────────── */}
      <div
        id="app-topbar"
        className="lg:hidden sticky top-0 z-40 flex h-12 items-center justify-between border-b border-[var(--border)] bg-[var(--background)]/80 px-4 backdrop-blur"
      >
        <Link
          id="app-topbar-logo"
          href="/app"
          className="flex items-center gap-2 text-sm font-bold text-[var(--foreground)]"
        >
          <Image
            src="/logo.png"
            alt=""
            width={24}
            height={24}
            className="h-6 w-auto logo-animated"
            priority
          />
          <span className="text-[var(--primary)]">TravelSync</span>
        </Link>

        <button
          id="app-topbar-menu-btn"
          type="button"
          aria-label={open ? copy.closeMenu : copy.openMenu}
          aria-expanded={open}
          aria-controls="app-sidebar-drawer"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--muted-foreground)] hover:bg-[var(--secondary)] hover:text-[var(--foreground)]"
        >
          {open ? (
            <svg
              width="18"
              height="18"
              viewBox="0 0 18 18"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden
            >
              <line x1="2" y1="2" x2="16" y2="16" />
              <line x1="16" y1="2" x2="2" y2="16" />
            </svg>
          ) : (
            <svg
              width="18"
              height="18"
              viewBox="0 0 18 18"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden
            >
              <line x1="2" y1="4" x2="16" y2="4" />
              <line x1="2" y1="9" x2="16" y2="9" />
              <line x1="2" y1="14" x2="16" y2="14" />
            </svg>
          )}
        </button>
      </div>

      {/* ── Mobile overlay ────────────────────────────────────────── */}
      {open && (
        <div
          id="app-sidebar-overlay"
          className="lg:hidden fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
          aria-hidden
          onClick={() => setOpen(false)}
        />
      )}

      {/* ── Mobile sliding drawer ─────────────────────────────────── */}
      <aside
        id="app-sidebar-drawer"
        aria-label={copy.openMenu}
        className={cn(
          "lg:hidden fixed inset-y-0 left-0 z-50 w-64 flex-col border-r border-[var(--border)] bg-[var(--background)] transition-transform duration-300 ease-in-out flex",
          open ? "translate-x-0 shadow-2xl" : "-translate-x-full"
        )}
      >
        {sidebarContent}
      </aside>
    </>
  );
}

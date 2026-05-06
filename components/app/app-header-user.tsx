"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAppLocale } from "@/components/app/app-locale-provider";
import { Button } from "@/components/ui/button";
import { appFetch } from "@/lib/app-client";
import { clearAppBrowserCache } from "@/lib/app-browser-cache";

const COPY = {
  en: {
    signIn: "Sign in",
    signOut: "Sign out",
    traveler: "Traveler",
  },
  "zh-TW": {
    signIn: "登入",
    signOut: "登出",
    traveler: "旅伴",
  },
} as const;

export function AppHeaderUser({
  user,
}: {
  user: { lineUserId: string; displayName: string | null } | null;
}) {
  const router = useRouter();
  const { locale } = useAppLocale();
  const copy = COPY[locale];

  if (!user) {
    return (
      <Link
        href="/app/sign-in"
        className="rounded-full bg-[var(--primary)] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
      >
        {copy.signIn}
      </Link>
    );
  }

  async function handleSignOut() {
    await appFetch("/api/app/sign-in", { method: "DELETE" });
    clearAppBrowserCache();
    router.push("/app/sign-in");
    router.refresh();
  }

  return (
    <div className="flex items-center gap-2">
      <div className="hidden text-right sm:block">
        <p className="text-xs font-medium leading-tight text-[var(--foreground)]">
          {user.displayName ?? copy.traveler}
        </p>
        <p className="max-w-[140px] truncate text-[10px] leading-tight text-[var(--muted-foreground)]">
          {user.lineUserId}
        </p>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={() => void handleSignOut()}
        className="h-8 rounded-full px-3 text-xs"
      >
        {copy.signOut}
      </Button>
    </div>
  );
}

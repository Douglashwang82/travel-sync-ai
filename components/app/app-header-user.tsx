"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { appFetch } from "@/lib/app-client";

export function AppHeaderUser({
  user,
}: {
  user: { lineUserId: string; displayName: string | null } | null;
}) {
  const router = useRouter();

  if (!user) {
    return (
      <Link
        href="/app/sign-in"
        className="rounded-full bg-[var(--primary)] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
      >
        Sign in
      </Link>
    );
  }

  async function handleSignOut() {
    await appFetch("/api/app/sign-in", { method: "DELETE" });
    router.push("/app/sign-in");
    router.refresh();
  }

  return (
    <div className="flex items-center gap-2">
      <div className="hidden text-right sm:block">
        <p className="text-xs font-medium leading-tight text-[var(--foreground)]">
          {user.displayName ?? "Traveler"}
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
        Sign out
      </Button>
    </div>
  );
}

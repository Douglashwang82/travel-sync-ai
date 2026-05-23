"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { appFetch } from "@/lib/app-client";

interface TripCardDeleteButtonProps {
  tripId: string;
  label: string;
  confirmMessage: string;
  tripLabel: string;
}

export function TripCardDeleteButton({
  tripId,
  label,
  confirmMessage,
  tripLabel,
}: TripCardDeleteButtonProps) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);

  async function handleClick(e: React.MouseEvent<HTMLButtonElement>) {
    e.preventDefault();
    e.stopPropagation();
    if (deleting) return;
    if (!confirm(confirmMessage)) return;
    setDeleting(true);
    try {
      const res = await appFetch(`/api/app/trips/${tripId}`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        alert(body.error ?? `Failed to delete ${tripLabel}`);
        setDeleting(false);
        return;
      }
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : `Failed to delete ${tripLabel}`);
      setDeleting(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={deleting}
      aria-label={label}
      title={label}
      className="relative z-10 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[var(--muted-foreground)] opacity-60 transition-colors hover:bg-[var(--secondary)] hover:text-red-600 disabled:cursor-wait disabled:opacity-40"
    >
      <Trash2 className="size-3.5" aria-hidden="true" />
    </button>
  );
}

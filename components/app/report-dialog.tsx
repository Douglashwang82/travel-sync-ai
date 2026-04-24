"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { appFetchJson } from "@/lib/app-client";

export function ReportDialog({
  open,
  title,
  endpoint,
  onClose,
}: {
  open: boolean;
  title: string;
  endpoint: string;
  onClose: (submitted: boolean) => void;
}) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit() {
    const trimmed = reason.trim();
    if (!trimmed) return;
    setSubmitting(true);
    setError(null);
    try {
      await appFetchJson(endpoint, {
        method: "POST",
        body: JSON.stringify({ reason: trimmed }),
      });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit report");
    } finally {
      setSubmitting(false);
    }
  }

  function handleClose() {
    const submitted = done;
    setReason("");
    setError(null);
    setDone(false);
    onClose(submitted);
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{done ? "Report received" : `Report ${title}`}</DialogTitle>
        </DialogHeader>

        {done ? (
          <div className="space-y-3 py-2 text-sm text-[var(--muted-foreground)]">
            <p>
              Thanks for letting us know. Our team will review this shortly.
            </p>
          </div>
        ) : (
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="report-reason">Why are you reporting this?</Label>
              <Textarea
                id="report-reason"
                placeholder="e.g. spam, inappropriate content, copied without credit…"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={1000}
                rows={4}
                disabled={submitting}
              />
              <p className="text-[11px] text-[var(--muted-foreground)]">
                {reason.length}/1000
              </p>
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
        )}

        <DialogFooter>
          {done ? (
            <Button onClick={handleClose}>Close</Button>
          ) : (
            <>
              <Button variant="outline" onClick={handleClose} disabled={submitting}>
                Cancel
              </Button>
              <Button onClick={() => void submit()} disabled={submitting || !reason.trim()}>
                {submitting ? "Submitting…" : "Submit report"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

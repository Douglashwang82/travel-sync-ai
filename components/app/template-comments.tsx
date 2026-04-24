"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { appFetchJson } from "@/lib/app-client";
import { ReportDialog } from "@/components/app/report-dialog";

interface CommentView {
  id: string;
  line_user_id: string | null;
  author_display_name: string | null;
  body: string | null;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
}

const PAGE_SIZE = 20;

export function TemplateCommentsSection({
  slug,
  viewerLineUserId,
  isTemplateAuthor,
}: {
  slug: string;
  viewerLineUserId: string;
  isTemplateAuthor: boolean;
}) {
  const [comments, setComments] = useState<CommentView[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);

  const load = useCallback(
    async (start: number, append: boolean) => {
      if (append) setLoadingMore(true);
      setLoadError(null);
      try {
        const res = await appFetchJson<{
          comments: CommentView[];
          hasMore: boolean;
          nextOffset: number;
        }>(`/api/app/templates/${slug}/comments?limit=${PAGE_SIZE}&offset=${start}`);
        setComments((prev) =>
          append ? [...(prev ?? []), ...res.comments] : res.comments
        );
        setHasMore(res.hasMore);
        setOffset(res.nextOffset);
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : "Failed to load comments");
      } finally {
        setLoadingMore(false);
      }
    },
    [slug]
  );

  useEffect(() => {
    void load(0, false);
  }, [load]);

  async function handlePost(e: React.FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body) return;
    setPosting(true);
    setPostError(null);
    try {
      const res = await appFetchJson<{ comment: CommentView }>(
        `/api/app/templates/${slug}/comments`,
        { method: "POST", body: JSON.stringify({ body }) }
      );
      setComments((prev) => [...(prev ?? []), res.comment]);
      setOffset((o) => o + 1);
      setDraft("");
    } catch (err) {
      setPostError(err instanceof Error ? err.message : "Failed to post comment");
    } finally {
      setPosting(false);
    }
  }

  function handleUpdated(updated: CommentView) {
    setComments((prev) =>
      (prev ?? []).map((c) => (c.id === updated.id ? updated : c))
    );
  }

  function handleDeleted(id: string) {
    setComments((prev) =>
      (prev ?? []).map((c) =>
        c.id === id
          ? {
              ...c,
              body: null,
              author_display_name: null,
              line_user_id: null,
              deleted_at: new Date().toISOString(),
            }
          : c
      )
    );
  }

  return (
    <section className="space-y-4">
      <h2 className="text-base font-semibold">Comments</h2>

      <form
        onSubmit={(e) => void handlePost(e)}
        className="space-y-2 rounded-2xl border border-[var(--border)] bg-[var(--background)] p-4"
      >
        <Textarea
          placeholder="Ask a question or share what you loved…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={2000}
          rows={3}
          disabled={posting}
        />
        {postError && <p className="text-xs text-destructive">{postError}</p>}
        <div className="flex items-center justify-between text-xs text-[var(--muted-foreground)]">
          <span>{draft.length}/2000</span>
          <Button type="submit" size="sm" disabled={posting || !draft.trim()}>
            {posting ? "Posting…" : "Post comment"}
          </Button>
        </div>
      </form>

      {loadError && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {loadError}
        </div>
      )}

      {comments === null ? (
        <div className="h-24 animate-pulse rounded-2xl bg-[var(--secondary)]" />
      ) : comments.length === 0 ? (
        <p className="text-sm text-[var(--muted-foreground)]">
          No comments yet. Be the first to start the conversation.
        </p>
      ) : (
        <ul className="space-y-3">
          {comments.map((c) => (
            <li key={c.id}>
              <CommentItem
                slug={slug}
                comment={c}
                viewerLineUserId={viewerLineUserId}
                isTemplateAuthor={isTemplateAuthor}
                onUpdated={handleUpdated}
                onDeleted={handleDeleted}
              />
            </li>
          ))}
        </ul>
      )}

      {hasMore && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load(offset, true)}
            disabled={loadingMore}
          >
            {loadingMore ? "Loading…" : "Load more"}
          </Button>
        </div>
      )}
    </section>
  );
}

function CommentItem({
  slug,
  comment,
  viewerLineUserId,
  isTemplateAuthor,
  onUpdated,
  onDeleted,
}: {
  slug: string;
  comment: CommentView;
  viewerLineUserId: string;
  isTemplateAuthor: boolean;
  onUpdated: (c: CommentView) => void;
  onDeleted: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body ?? "");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [reportOpen, setReportOpen] = useState(false);

  const isDeleted = comment.deleted_at != null;
  const isMine = !isDeleted && comment.line_user_id === viewerLineUserId;
  const canDelete = !isDeleted && (isMine || isTemplateAuthor);
  const canReport = !isDeleted && !isMine;

  async function handleSave() {
    const body = draft.trim();
    if (!body) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await appFetchJson<{ comment: CommentView }>(
        `/api/app/templates/${slug}/comments/${comment.id}`,
        { method: "PATCH", body: JSON.stringify({ body }) }
      );
      onUpdated(res.comment);
      setEditing(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm("Delete this comment? This can't be undone.")) return;
    try {
      await appFetchJson(`/api/app/templates/${slug}/comments/${comment.id}`, {
        method: "DELETE",
      });
      onDeleted(comment.id);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete");
    }
  }

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--background)] p-4 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <span className="text-sm font-medium">
            {isDeleted
              ? "[deleted]"
              : comment.author_display_name ?? "Anonymous"}
          </span>
          <span className="ml-2 text-[11px] text-[var(--muted-foreground)]">
            {formatRelative(comment.created_at)}
            {comment.edited_at && !isDeleted && (
              <span className="ml-1 italic" title={`Edited ${formatRelative(comment.edited_at)}`}>
                (edited)
              </span>
            )}
          </span>
        </div>
        {!isDeleted && (isMine || canDelete || canReport) && !editing && (
          <div className="flex items-center gap-2">
            {isMine && (
              <button
                type="button"
                onClick={() => {
                  setDraft(comment.body ?? "");
                  setEditing(true);
                }}
                className="text-[11px] text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              >
                Edit
              </button>
            )}
            {canDelete && (
              <button
                type="button"
                onClick={() => void handleDelete()}
                className="text-[11px] text-[var(--muted-foreground)] hover:text-destructive"
              >
                Delete
              </button>
            )}
            {canReport && (
              <button
                type="button"
                onClick={() => setReportOpen(true)}
                className="text-[11px] text-[var(--muted-foreground)] hover:text-destructive"
              >
                Report
              </button>
            )}
          </div>
        )}
      </div>

      {editing ? (
        <div className="space-y-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={2000}
            rows={3}
            disabled={saving}
          />
          {saveError && <p className="text-xs text-destructive">{saveError}</p>}
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setEditing(false);
                setSaveError(null);
              }}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => void handleSave()}
              disabled={saving || !draft.trim() || draft.trim() === comment.body}
            >
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      ) : (
        <p
          className={`text-sm whitespace-pre-wrap ${
            isDeleted ? "italic text-[var(--muted-foreground)]" : ""
          }`}
        >
          {isDeleted ? "This comment has been deleted." : comment.body}
        </p>
      )}

      <ReportDialog
        open={reportOpen}
        title="comment"
        endpoint={`/api/app/templates/${slug}/comments/${comment.id}/report`}
        onClose={() => setReportOpen(false)}
      />
    </div>
  );
}

function formatRelative(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffSec = Math.round((now.getTime() - date.getTime()) / 1000);
  if (diffSec < 60) return "just now";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  if (diffSec < 7 * 86400) return `${Math.floor(diffSec / 86400)}d ago`;
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}

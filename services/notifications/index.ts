import { createAdminClient } from "@/lib/db";
import { pushText } from "@/lib/line";
import type { Notification, NotificationKind } from "@/lib/types";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
}

function templateLink(slug: string): string {
  const base = appUrl();
  return base ? `${base}/app/templates/${slug}` : `/app/templates/${slug}`;
}

// ─── Create ───────────────────────────────────────────────────────────────────

export interface CreateNotificationInput {
  recipientUserId: string;
  kind: NotificationKind;
  payload: Record<string, unknown>;
  /**
   * Optional LINE push text. Sent best-effort — a failed push (e.g. the user
   * has never opened a 1:1 chat with the bot) never blocks the in-app
   * notification.
   */
  linePushText?: string;
}

/**
 * Writes a row to `notifications` and optionally fires a LINE push.
 * Never throws — this is fire-and-forget for callers.
 */
export async function createNotification(
  input: CreateNotificationInput
): Promise<void> {
  const db = createAdminClient();

  const { error } = await db.from("notifications").insert({
    recipient_user_id: input.recipientUserId,
    kind: input.kind,
    payload: input.payload,
  });
  if (error) {
    console.error("Failed to create notification:", error);
  }

  if (input.linePushText) {
    try {
      await pushText(input.recipientUserId, input.linePushText);
    } catch (err) {
      // pushText already tracks in outbound_messages; just log here
      console.error("LINE push failed:", err);
    }
  }
}

// ─── High-level event helpers ────────────────────────────────────────────────
// Each function encapsulates the payload shape + LINE push copy for one event.
// Callers just pass the minimum context; this module owns the rest.

export async function notifyAccessRequested(args: {
  authorLineUserId: string;
  requesterLineUserId: string;
  requesterDisplayName: string | null;
  slug: string;
  templateTitle: string;
  message: string | null;
}): Promise<void> {
  const who = args.requesterDisplayName ?? "有人";
  return createNotification({
    recipientUserId: args.authorLineUserId,
    kind: "template.access_requested",
    payload: {
      slug: args.slug,
      templateTitle: args.templateTitle,
      requesterUserId: args.requesterLineUserId,
      requesterDisplayName: args.requesterDisplayName,
      message: args.message,
    },
    linePushText: `${who}申請存取你的範本「${args.templateTitle}」。審核：${templateLink(args.slug)}`,
  });
}

export async function notifyAccessDecided(args: {
  requesterLineUserId: string;
  decision: "approved" | "denied";
  slug: string;
  templateTitle: string;
  authorDisplayName: string | null;
}): Promise<void> {
  const verb = args.decision === "approved" ? "approved" : "denied";
  const pushText =
    args.decision === "approved"
      ? `你申請存取「${args.templateTitle}」的請求已通過。開啟：${templateLink(args.slug)}`
      : `你申請存取「${args.templateTitle}」的請求未通過。`;
  return createNotification({
    recipientUserId: args.requesterLineUserId,
    kind: args.decision === "approved" ? "template.access_approved" : "template.access_denied",
    payload: {
      slug: args.slug,
      templateTitle: args.templateTitle,
      authorDisplayName: args.authorDisplayName,
      decision: verb,
    },
    linePushText: pushText,
  });
}

export async function notifyInvited(args: {
  inviteeLineUserId: string;
  slug: string;
  templateTitle: string;
  authorDisplayName: string | null;
}): Promise<void> {
  const inviter = args.authorDisplayName ?? "有人";
  return createNotification({
    recipientUserId: args.inviteeLineUserId,
    kind: "template.invited",
    payload: {
      slug: args.slug,
      templateTitle: args.templateTitle,
      authorDisplayName: args.authorDisplayName,
    },
    linePushText: `${inviter}邀請你查看他們的範本「${args.templateTitle}」。開啟：${templateLink(args.slug)}`,
  });
}

export async function notifyNewComment(args: {
  authorLineUserId: string;
  commenterLineUserId: string;
  commenterDisplayName: string | null;
  slug: string;
  templateTitle: string;
  commentId: string;
  bodyExcerpt: string;
}): Promise<void> {
  if (args.commenterLineUserId === args.authorLineUserId) return; // no self-notify
  const who = args.commenterDisplayName ?? "有人";
  return createNotification({
    recipientUserId: args.authorLineUserId,
    kind: "template.new_comment",
    payload: {
      slug: args.slug,
      templateTitle: args.templateTitle,
      commenterUserId: args.commenterLineUserId,
      commenterDisplayName: args.commenterDisplayName,
      commentId: args.commentId,
      bodyExcerpt: args.bodyExcerpt,
    },
    linePushText: `${who}在「${args.templateTitle}」留下了留言。閱讀：${templateLink(args.slug)}`,
  });
}

export async function notifyForked(args: {
  authorLineUserId: string;
  forkerLineUserId: string;
  forkerDisplayName: string | null;
  slug: string;
  templateTitle: string;
}): Promise<void> {
  if (args.forkerLineUserId === args.authorLineUserId) return; // no self-notify
  const who = args.forkerDisplayName ?? "有人";
  return createNotification({
    recipientUserId: args.authorLineUserId,
    kind: "template.forked",
    payload: {
      slug: args.slug,
      templateTitle: args.templateTitle,
      forkerUserId: args.forkerLineUserId,
      forkerDisplayName: args.forkerDisplayName,
    },
    linePushText: `${who}複製了你的範本「${args.templateTitle}」。`,
  });
}

// ─── Inbox queries ────────────────────────────────────────────────────────────

export interface ListNotificationsInput {
  unreadOnly?: boolean;
  limit?: number;
  offset?: number;
}

export interface ListNotificationsResult {
  notifications: Notification[];
  hasMore: boolean;
  nextOffset: number;
}

export async function listNotifications(
  viewerLineUserId: string,
  input: ListNotificationsInput
): Promise<ListNotificationsResult> {
  const db = createAdminClient();
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
  const offset = Math.max(input.offset ?? 0, 0);

  let query = db
    .from("notifications")
    .select("id, recipient_user_id, kind, payload, read_at, created_at")
    .eq("recipient_user_id", viewerLineUserId)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit);
  if (input.unreadOnly) query = query.is("read_at", null);

  const { data } = await query;
  const raw = (data ?? []) as Notification[];
  const hasMore = raw.length > limit;
  const page = hasMore ? raw.slice(0, limit) : raw;

  return {
    notifications: page,
    hasMore,
    nextOffset: offset + page.length,
  };
}

export async function markNotificationsRead(
  viewerLineUserId: string,
  ids?: string[]
): Promise<{ updated: number }> {
  const db = createAdminClient();
  const nowIso = new Date().toISOString();

  let query = db
    .from("notifications")
    .update({ read_at: nowIso })
    .eq("recipient_user_id", viewerLineUserId)
    .is("read_at", null);
  if (ids && ids.length > 0) query = query.in("id", ids);

  const { data, error } = await query.select("id");
  if (error) return { updated: 0 };
  return { updated: (data ?? []).length };
}

export async function countUnreadNotifications(
  viewerLineUserId: string
): Promise<number> {
  const db = createAdminClient();
  const { count } = await db
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("recipient_user_id", viewerLineUserId)
    .is("read_at", null);
  return count ?? 0;
}

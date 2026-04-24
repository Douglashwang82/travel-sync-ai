import { createHash, randomBytes } from "node:crypto";
import { createAdminClient } from "@/lib/db";
import {
  notifyAccessRequested,
  notifyAccessDecided,
  notifyInvited,
  notifyNewComment,
  notifyForked,
} from "@/services/notifications";
import type {
  TripTemplate,
  TripTemplateVersion,
  TripTemplateItem,
  TemplateVisibility,
  ItemType,
} from "@/lib/types";

// ─── Result type ──────────────────────────────────────────────────────────────

export type TemplateResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code: string };

// ─── Publish ──────────────────────────────────────────────────────────────────

export interface PublishInput {
  tripId: string;
  authorLineUserId: string;
  title: string;
  summary: string | null;
  coverImageUrl: string | null;
  tags: string[];
  visibility: TemplateVisibility;
  templateId?: string;
}

export interface PublishOutput {
  template: TripTemplate;
  version: TripTemplateVersion;
  isNewTemplate: boolean;
}

export async function publishTemplate(
  input: PublishInput
): Promise<TemplateResult<PublishOutput>> {
  const db = createAdminClient();

  const { data: trip } = await db
    .from("trips")
    .select("id, destination_name, start_date, end_date")
    .eq("id", input.tripId)
    .single();
  if (!trip) return { ok: false, error: "Trip not found", code: "NOT_FOUND" };

  // Compute duration from trip dates; fall back to 1 day
  let durationDays = 1;
  if (trip.start_date && trip.end_date) {
    const diff = Math.round(
      (new Date(trip.end_date + "T00:00:00").getTime() -
        new Date(trip.start_date + "T00:00:00").getTime()) /
        86_400_000
    );
    durationDays = Math.max(1, diff + 1);
  }

  // Fetch items with their confirmed option's place details
  const { data: items } = await db
    .from("trip_items")
    .select("id, item_type, title, description, confirmed_option_id")
    .eq("trip_id", input.tripId)
    .order("created_at");

  const confirmedIds = (items ?? [])
    .map((i) => i.confirmed_option_id)
    .filter((id): id is string => id != null);

  const optionMap: Record<
    string,
    { name: string; address: string | null; lat: number | null; lng: number | null; booking_url: string | null }
  > = {};
  if (confirmedIds.length > 0) {
    const { data: opts } = await db
      .from("trip_item_options")
      .select("id, name, address, lat, lng, booking_url")
      .in("id", confirmedIds);
    for (const opt of opts ?? []) {
      optionMap[opt.id as string] = opt as typeof optionMap[string];
    }
  }

  // Build sanitized template items (all day 1 — trip_items have no per-item dates yet)
  const templateItems = (items ?? []).map((item, idx) => {
    const opt = item.confirmed_option_id ? optionMap[item.confirmed_option_id] : null;
    return {
      day_number: 1,
      order_index: idx,
      item_type: item.item_type as ItemType,
      title: item.title as string,
      notes: (item.description as string | null) ?? null,
      place_name: opt?.name ?? null,
      address: opt?.address ?? null,
      lat: opt?.lat ?? null,
      lng: opt?.lng ?? null,
      external_url: opt?.booking_url ?? null,
      duration_minutes: null as number | null,
    };
  });

  const contentHash = computeContentHash(templateItems, input.title, input.summary);

  let templateId = input.templateId;
  let versionNumber = 1;
  let isNewTemplate = false;

  if (!templateId) {
    // New template: enforce ≤3/day per author
    const { data: todayCount } = await db.rpc("count_author_templates_today", {
      p_author_line_user_id: input.authorLineUserId,
    });
    if (((todayCount as number | null) ?? 0) >= 3) {
      return { ok: false, error: "Daily template limit reached (3 per day)", code: "RATE_LIMITED" };
    }
  } else {
    // Adding version to existing template: verify ownership
    const { data: existing } = await db
      .from("trip_templates")
      .select("id, author_line_user_id")
      .eq("id", templateId)
      .is("deleted_at", null)
      .single();
    if (!existing) return { ok: false, error: "Template not found", code: "NOT_FOUND" };
    if ((existing.author_line_user_id as string) !== input.authorLineUserId) {
      return { ok: false, error: "Not the template author", code: "FORBIDDEN" };
    }

    // Enforce ≤1 version/template/day
    const { data: versionCount } = await db.rpc("count_template_versions_today", {
      p_template_id: templateId,
    });
    if (((versionCount as number | null) ?? 0) >= 1) {
      return { ok: false, error: "Version limit reached (1 per day per template)", code: "RATE_LIMITED" };
    }

    // Block identical re-publish
    const { data: lastVersion } = await db
      .from("trip_template_versions")
      .select("content_hash, version_number")
      .eq("template_id", templateId)
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    if ((lastVersion?.content_hash as string | undefined) === contentHash) {
      return { ok: false, error: "No changes detected since last publish", code: "NO_CHANGES" };
    }
    versionNumber = ((lastVersion?.version_number as number | undefined) ?? 0) + 1;
  }

  // Create new template header if needed
  if (!templateId) {
    const slug = generateSlug(input.title);
    const { data: newTemplate, error: tmplErr } = await db
      .from("trip_templates")
      .insert({ author_line_user_id: input.authorLineUserId, slug, visibility: input.visibility })
      .select("*")
      .single();
    if (tmplErr || !newTemplate) {
      return { ok: false, error: "Failed to create template", code: "DB_ERROR" };
    }
    templateId = (newTemplate.id as string);
    isNewTemplate = true;
  }

  // Insert version snapshot
  const { data: newVersion, error: verErr } = await db
    .from("trip_template_versions")
    .insert({
      template_id: templateId,
      version_number: versionNumber,
      source_trip_id: input.tripId,
      title: input.title,
      destination_name: (trip.destination_name as string | null) ?? input.title,
      duration_days: durationDays,
      summary: input.summary,
      cover_image_url: input.coverImageUrl,
      tags: input.tags,
      content_hash: contentHash,
    })
    .select("*")
    .single();
  if (verErr || !newVersion) {
    return { ok: false, error: "Failed to create template version", code: "DB_ERROR" };
  }

  // Insert items
  if (templateItems.length > 0) {
    const { error: itemErr } = await db
      .from("trip_template_items")
      .insert(templateItems.map((item) => ({ ...item, version_id: newVersion.id as string })));
    if (itemErr) {
      return { ok: false, error: "Failed to save template items", code: "DB_ERROR" };
    }
  }

  // Point template at new version
  const { data: updatedTemplate, error: updErr } = await db
    .from("trip_templates")
    .update({ current_version_id: newVersion.id as string })
    .eq("id", templateId)
    .select("*")
    .single();
  if (updErr || !updatedTemplate) {
    return { ok: false, error: "Failed to update template", code: "DB_ERROR" };
  }

  return {
    ok: true,
    data: {
      template: updatedTemplate as unknown as TripTemplate,
      version: newVersion as unknown as TripTemplateVersion,
      isNewTemplate,
    },
  };
}

// ─── Get template ─────────────────────────────────────────────────────────────

export type TemplateAccess = "full" | "preview";

export interface TemplateWithAccess {
  template: TripTemplate;
  version: TripTemplateVersion;
  items: TripTemplateItem[];
  access: TemplateAccess;
  isAuthor: boolean;
  hasLiked: boolean;
  requestStatus: "none" | "pending" | "approved" | "denied";
}

/**
 * Fetch a template with visibility/grant enforcement.
 *
 * Access rules:
 *  - Author of the template always sees full content.
 *  - Anyone in template_grants sees full content.
 *  - visibility='public' → full content for everyone.
 *  - visibility='request_only' → non-granted viewers get a preview (no items).
 *  - visibility='private' → non-granted viewers get NOT_FOUND (don't leak existence).
 */
export async function getTemplate(
  slug: string,
  viewerLineUserId: string
): Promise<TemplateResult<TemplateWithAccess>> {
  const db = createAdminClient();

  const { data: template } = await db
    .from("trip_templates")
    .select("*")
    .eq("slug", slug)
    .is("deleted_at", null)
    .single();
  if (!template) return { ok: false, error: "Template not found", code: "NOT_FOUND" };
  if (!template.current_version_id) {
    return { ok: false, error: "Template has no published version", code: "NOT_FOUND" };
  }

  const isAuthor = (template.author_line_user_id as string) === viewerLineUserId;
  const visibility = template.visibility as "public" | "private" | "request_only";

  // Determine access level
  let access: TemplateAccess = "full";
  let hasGrant = false;
  if (!isAuthor && visibility !== "public") {
    const { data: grant } = await db
      .from("template_grants")
      .select("template_id")
      .eq("template_id", template.id as string)
      .eq("line_user_id", viewerLineUserId)
      .maybeSingle();
    hasGrant = grant != null;

    if (!hasGrant) {
      if (visibility === "private") {
        return { ok: false, error: "Template not found", code: "NOT_FOUND" };
      }
      // request_only without grant → preview
      access = "preview";
    }
  }

  const { data: version } = await db
    .from("trip_template_versions")
    .select("*")
    .eq("id", template.current_version_id as string)
    .single();
  if (!version) return { ok: false, error: "Template version not found", code: "NOT_FOUND" };

  let items: TripTemplateItem[] = [];
  if (access === "full") {
    const { data: itemRows } = await db
      .from("trip_template_items")
      .select("*")
      .eq("version_id", version.id as string)
      .order("day_number")
      .order("order_index");
    items = (itemRows ?? []) as unknown as TripTemplateItem[];
  }

  const { data: likeRow } = await db
    .from("template_likes")
    .select("template_id")
    .eq("template_id", template.id as string)
    .eq("line_user_id", viewerLineUserId)
    .maybeSingle();
  const hasLiked = likeRow != null;

  let requestStatus: "none" | "pending" | "approved" | "denied" = "none";
  if (!isAuthor && visibility === "request_only") {
    const { data: reqRow } = await db
      .from("template_access_requests")
      .select("status")
      .eq("template_id", template.id as string)
      .eq("requester_user_id", viewerLineUserId)
      .maybeSingle();
    if (reqRow) {
      requestStatus = reqRow.status as "pending" | "approved" | "denied";
    }
  }

  return {
    ok: true,
    data: {
      template: template as unknown as TripTemplate,
      version: version as unknown as TripTemplateVersion,
      items,
      access,
      isAuthor,
      hasLiked,
      requestStatus,
    },
  };
}

// ─── Fork ─────────────────────────────────────────────────────────────────────

export interface ForkInput {
  slug: string;
  groupId: string;
  startDate: string;
  lineUserId: string;
}

export async function forkTemplate(
  input: ForkInput
): Promise<TemplateResult<{ tripId: string }>> {
  const db = createAdminClient();

  const result = await getTemplate(input.slug, input.lineUserId);
  if (!result.ok) return result;
  const { template, version, items, access } = result.data;

  // Fork requires full access — preview (request_only not yet granted) can't fork
  if (access !== "full") {
    return {
      ok: false,
      error: "Request access before forking this template",
      code: "FORBIDDEN",
    };
  }

  // Verify the user is an active member of the target group
  const { data: membership } = await db
    .from("group_members")
    .select("role")
    .eq("group_id", input.groupId)
    .eq("line_user_id", input.lineUserId)
    .is("left_at", null)
    .single();
  if (!membership) {
    return { ok: false, error: "You are not a member of the selected group", code: "FORBIDDEN" };
  }

  const startTs = new Date(input.startDate + "T00:00:00");
  const endTs = new Date(startTs);
  endTs.setDate(startTs.getDate() + version.duration_days - 1);
  const endDate = endTs.toISOString().slice(0, 10);

  const { data: newTrip, error: tripErr } = await db
    .from("trips")
    .insert({
      group_id: input.groupId,
      title: version.title,
      destination_name: version.destination_name,
      start_date: input.startDate,
      end_date: endDate,
      status: "draft",
      created_by_user_id: input.lineUserId,
      forked_from_version_id: version.id,
    })
    .select("id")
    .single();

  if (tripErr || !newTrip) {
    if ((tripErr as { code?: string } | null)?.code === "23505") {
      return {
        ok: false,
        error: "This group already has an active trip. Complete or cancel it first.",
        code: "CONFLICT",
      };
    }
    return { ok: false, error: "Failed to create trip", code: "DB_ERROR" };
  }

  if (items.length > 0) {
    const tripItems = items.map((item) => ({
      trip_id: newTrip.id as string,
      item_type: item.item_type,
      item_kind: "task",
      title: item.title,
      description: item.notes,
      stage: "todo",
      source: "manual",
    }));
    const { error: itemsErr } = await db.from("trip_items").insert(tripItems);
    if (itemsErr) {
      console.error("Failed to insert forked trip items:", itemsErr);
    }
  }

  // Increment fork count (best-effort)
  await db
    .from("trip_templates")
    .update({ fork_count: template.fork_count + 1 })
    .eq("id", template.id);

  // Notify the template author of the fork (best-effort; skips self-notify)
  const forkerNameMap = await resolveDisplayNames(db, [input.lineUserId]);
  await notifyForked({
    authorLineUserId: template.author_line_user_id,
    forkerLineUserId: input.lineUserId,
    forkerDisplayName: forkerNameMap[input.lineUserId] ?? null,
    slug: template.slug,
    templateTitle: version.title,
  });

  return { ok: true, data: { tripId: newTrip.id as string } };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function generateSlug(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 40);
  const suffix = randomBytes(4).toString("hex");
  return base ? `${base}-${suffix}` : suffix;
}

function computeContentHash(
  items: Array<{
    day_number: number;
    order_index: number;
    item_type: string;
    title: string;
    notes: string | null;
    place_name: string | null;
    address: string | null;
    external_url: string | null;
    duration_minutes: number | null;
  }>,
  title: string,
  summary: string | null
): string {
  const canonical = JSON.stringify({
    title,
    summary,
    items: items.map((i) => ({
      day: i.day_number,
      order: i.order_index,
      type: i.item_type,
      title: i.title,
      notes: i.notes,
      place: i.place_name,
      address: i.address,
      url: i.external_url,
      duration: i.duration_minutes,
    })),
  });
  return createHash("sha256").update(canonical).digest("hex");
}

// ─── Update template (author only) ───────────────────────────────────────────

export interface UpdateTemplateInput {
  slug: string;
  authorLineUserId: string;
  visibility?: TemplateVisibility;
}

export async function updateTemplate(
  input: UpdateTemplateInput
): Promise<TemplateResult<{ template: TripTemplate }>> {
  const db = createAdminClient();

  const { data: template } = await db
    .from("trip_templates")
    .select("id, author_line_user_id")
    .eq("slug", input.slug)
    .is("deleted_at", null)
    .single();
  if (!template) return { ok: false, error: "Template not found", code: "NOT_FOUND" };
  if ((template.author_line_user_id as string) !== input.authorLineUserId) {
    return { ok: false, error: "Not the template author", code: "FORBIDDEN" };
  }

  const patch: Record<string, unknown> = {};
  if (input.visibility !== undefined) patch.visibility = input.visibility;
  if (Object.keys(patch).length === 0) {
    return { ok: false, error: "No changes provided", code: "VALIDATION_ERROR" };
  }

  const { data: updated, error } = await db
    .from("trip_templates")
    .update(patch)
    .eq("id", template.id as string)
    .select("*")
    .single();
  if (error || !updated) {
    return { ok: false, error: "Failed to update template", code: "DB_ERROR" };
  }

  return { ok: true, data: { template: updated as unknown as TripTemplate } };
}

// ─── Grants (invites) ─────────────────────────────────────────────────────────

export interface GrantWithDisplayName {
  line_user_id: string;
  display_name: string | null;
  granted_at: string;
  source: "invite" | "request";
}

async function loadTemplateAsAuthor(
  slug: string,
  authorLineUserId: string
): Promise<TemplateResult<{ id: string }>> {
  const db = createAdminClient();
  const { data: template } = await db
    .from("trip_templates")
    .select("id, author_line_user_id")
    .eq("slug", slug)
    .is("deleted_at", null)
    .single();
  if (!template) return { ok: false, error: "Template not found", code: "NOT_FOUND" };
  if ((template.author_line_user_id as string) !== authorLineUserId) {
    return { ok: false, error: "Not the template author", code: "FORBIDDEN" };
  }
  return { ok: true, data: { id: template.id as string } };
}

export async function listTemplateGrants(
  slug: string,
  authorLineUserId: string
): Promise<TemplateResult<{ grants: GrantWithDisplayName[] }>> {
  const tmpl = await loadTemplateAsAuthor(slug, authorLineUserId);
  if (!tmpl.ok) return tmpl;

  const db = createAdminClient();
  const { data: rows } = await db
    .from("template_grants")
    .select("line_user_id, granted_at, source")
    .eq("template_id", tmpl.data.id)
    .order("granted_at", { ascending: false });

  const userIds = (rows ?? []).map((r) => r.line_user_id as string);
  const nameMap: Record<string, string | null> = {};
  if (userIds.length > 0) {
    const { data: members } = await db
      .from("group_members")
      .select("line_user_id, display_name")
      .in("line_user_id", userIds)
      .is("left_at", null);
    for (const m of members ?? []) {
      const uid = m.line_user_id as string;
      if (!(uid in nameMap)) nameMap[uid] = (m.display_name as string | null) ?? null;
    }
  }

  const grants: GrantWithDisplayName[] = (rows ?? []).map((r) => ({
    line_user_id: r.line_user_id as string,
    display_name: nameMap[r.line_user_id as string] ?? null,
    granted_at: r.granted_at as string,
    source: r.source as "invite" | "request",
  }));

  return { ok: true, data: { grants } };
}

export async function addTemplateGrant(
  slug: string,
  authorLineUserId: string,
  inviteeLineUserId: string
): Promise<TemplateResult<{ grant: GrantWithDisplayName }>> {
  const tmpl = await loadTemplateAsAuthor(slug, authorLineUserId);
  if (!tmpl.ok) return tmpl;

  if (inviteeLineUserId === authorLineUserId) {
    return { ok: false, error: "You already have access as the author", code: "VALIDATION_ERROR" };
  }

  const db = createAdminClient();
  const { error } = await db
    .from("template_grants")
    .upsert(
      {
        template_id: tmpl.data.id,
        line_user_id: inviteeLineUserId,
        granted_by: authorLineUserId,
        source: "invite",
      },
      { onConflict: "template_id,line_user_id" }
    );
  if (error) {
    return { ok: false, error: "Failed to add invite", code: "DB_ERROR" };
  }

  const { data: member } = await db
    .from("group_members")
    .select("display_name")
    .eq("line_user_id", inviteeLineUserId)
    .is("left_at", null)
    .limit(1)
    .maybeSingle();

  // Notify the invitee (best-effort)
  const ctx = await loadTemplateNotificationContext(db, tmpl.data.id);
  if (ctx) {
    const authorNameMap = await resolveDisplayNames(db, [authorLineUserId]);
    await notifyInvited({
      inviteeLineUserId,
      slug: ctx.slug,
      templateTitle: ctx.title,
      authorDisplayName: authorNameMap[authorLineUserId] ?? null,
    });
  }

  return {
    ok: true,
    data: {
      grant: {
        line_user_id: inviteeLineUserId,
        display_name: (member?.display_name as string | null) ?? null,
        granted_at: new Date().toISOString(),
        source: "invite",
      },
    },
  };
}

export async function removeTemplateGrant(
  slug: string,
  authorLineUserId: string,
  inviteeLineUserId: string
): Promise<TemplateResult<{ removed: boolean }>> {
  const tmpl = await loadTemplateAsAuthor(slug, authorLineUserId);
  if (!tmpl.ok) return tmpl;

  const db = createAdminClient();
  const { error } = await db
    .from("template_grants")
    .delete()
    .eq("template_id", tmpl.data.id)
    .eq("line_user_id", inviteeLineUserId);
  if (error) {
    return { ok: false, error: "Failed to remove invite", code: "DB_ERROR" };
  }
  return { ok: true, data: { removed: true } };
}

// ─── Discovery search ─────────────────────────────────────────────────────────

export type TemplateSortOrder = "recent" | "forks" | "likes";

export interface SearchTemplatesInput {
  q?: string;
  tags?: string[];
  durationMin?: number;
  durationMax?: number;
  sort?: TemplateSortOrder;
  limit?: number;
  offset?: number;
}

export interface SearchResultItem {
  slug: string;
  visibility: TemplateVisibility;
  fork_count: number;
  like_count: number;
  comment_count: number;
  author_line_user_id: string;
  title: string;
  destination_name: string;
  duration_days: number;
  summary: string | null;
  cover_image_url: string | null;
  tags: string[];
  published_at: string;
}

export interface SearchResult {
  templates: SearchResultItem[];
  hasMore: boolean;
  nextOffset: number;
}

export async function searchTemplates(
  input: SearchTemplatesInput
): Promise<TemplateResult<SearchResult>> {
  const db = createAdminClient();
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 60);
  const offset = Math.max(input.offset ?? 0, 0);

  // Fetch one extra row to determine hasMore
  const { data, error } = await db.rpc("search_templates", {
    p_q: input.q?.trim() || null,
    p_tags: input.tags && input.tags.length > 0 ? input.tags : null,
    p_duration_min: input.durationMin ?? null,
    p_duration_max: input.durationMax ?? null,
    p_sort: input.sort ?? "recent",
    p_limit: limit + 1,
    p_offset: offset,
  });

  if (error) {
    return { ok: false, error: "Search failed", code: "DB_ERROR" };
  }

  type Row = {
    slug: string;
    visibility: TemplateVisibility;
    fork_count: number;
    like_count: number;
    comment_count: number;
    author_line_user_id: string;
    version_title: string;
    version_destination_name: string;
    version_duration_days: number;
    version_summary: string | null;
    version_cover_image_url: string | null;
    version_tags: string[];
    version_published_at: string;
  };
  const rows = (data as Row[] | null) ?? [];
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;

  const templates: SearchResultItem[] = pageRows.map((r) => ({
    slug: r.slug,
    visibility: r.visibility,
    fork_count: r.fork_count,
    like_count: r.like_count,
    comment_count: r.comment_count,
    author_line_user_id: r.author_line_user_id,
    title: r.version_title,
    destination_name: r.version_destination_name,
    duration_days: r.version_duration_days,
    summary: r.version_summary,
    cover_image_url: r.version_cover_image_url,
    tags: r.version_tags ?? [],
    published_at: r.version_published_at,
  }));

  return {
    ok: true,
    data: { templates, hasMore, nextOffset: offset + pageRows.length },
  };
}

// ─── Likes ────────────────────────────────────────────────────────────────────

export interface LikeResult {
  liked: boolean;
  likeCount: number;
}

/**
 * Resolves the template by slug and verifies the viewer is allowed to see it.
 * Returns the template id for further work.
 *
 * Private templates return NOT_FOUND unless the viewer is the author or
 * has a grant — consistent with getTemplate's visibility rules.
 */
async function resolveAccessibleTemplate(
  slug: string,
  viewerLineUserId: string
): Promise<TemplateResult<{ id: string }>> {
  const db = createAdminClient();

  const { data: template } = await db
    .from("trip_templates")
    .select("id, visibility, author_line_user_id")
    .eq("slug", slug)
    .is("deleted_at", null)
    .single();
  if (!template) return { ok: false, error: "Template not found", code: "NOT_FOUND" };

  const isAuthor = (template.author_line_user_id as string) === viewerLineUserId;
  const visibility = template.visibility as "public" | "private" | "request_only";

  if (!isAuthor && visibility === "private") {
    const { data: grant } = await db
      .from("template_grants")
      .select("template_id")
      .eq("template_id", template.id as string)
      .eq("line_user_id", viewerLineUserId)
      .maybeSingle();
    if (!grant) return { ok: false, error: "Template not found", code: "NOT_FOUND" };
  }

  return { ok: true, data: { id: template.id as string } };
}

export async function likeTemplate(
  slug: string,
  lineUserId: string
): Promise<TemplateResult<LikeResult>> {
  const resolved = await resolveAccessibleTemplate(slug, lineUserId);
  if (!resolved.ok) return resolved;

  const db = createAdminClient();

  // Idempotent insert: ON CONFLICT DO NOTHING avoids firing the like_count
  // trigger a second time if the user already liked this template.
  const { error: insertErr } = await db
    .from("template_likes")
    .upsert(
      { template_id: resolved.data.id, line_user_id: lineUserId },
      { onConflict: "template_id,line_user_id", ignoreDuplicates: true }
    );
  if (insertErr) {
    return { ok: false, error: "Failed to like template", code: "DB_ERROR" };
  }

  const { data: fresh } = await db
    .from("trip_templates")
    .select("like_count")
    .eq("id", resolved.data.id)
    .single();

  return {
    ok: true,
    data: { liked: true, likeCount: (fresh?.like_count as number | undefined) ?? 0 },
  };
}

export async function unlikeTemplate(
  slug: string,
  lineUserId: string
): Promise<TemplateResult<LikeResult>> {
  const resolved = await resolveAccessibleTemplate(slug, lineUserId);
  if (!resolved.ok) return resolved;

  const db = createAdminClient();

  const { error: delErr } = await db
    .from("template_likes")
    .delete()
    .eq("template_id", resolved.data.id)
    .eq("line_user_id", lineUserId);
  if (delErr) {
    return { ok: false, error: "Failed to unlike template", code: "DB_ERROR" };
  }

  const { data: fresh } = await db
    .from("trip_templates")
    .select("like_count")
    .eq("id", resolved.data.id)
    .single();

  return {
    ok: true,
    data: { liked: false, likeCount: (fresh?.like_count as number | undefined) ?? 0 },
  };
}

// ─── Comments ─────────────────────────────────────────────────────────────────

export interface CommentView {
  id: string;
  line_user_id: string | null;       // nulled if deleted
  author_display_name: string | null; // nulled if deleted
  body: string | null;                // nulled if deleted
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
}

async function resolveDisplayNames(
  db: ReturnType<typeof createAdminClient>,
  lineUserIds: string[]
): Promise<Record<string, string | null>> {
  const unique = Array.from(new Set(lineUserIds));
  if (unique.length === 0) return {};
  const { data } = await db
    .from("group_members")
    .select("line_user_id, display_name")
    .in("line_user_id", unique)
    .is("left_at", null);
  const map: Record<string, string | null> = {};
  for (const row of data ?? []) {
    const uid = row.line_user_id as string;
    if (!(uid in map)) map[uid] = (row.display_name as string | null) ?? null;
  }
  for (const uid of unique) if (!(uid in map)) map[uid] = null;
  return map;
}

/**
 * Look up the slug, current-version title, and author of a template by id.
 * Used to build notification payloads without duplicating the fetch in each
 * event site. Returns null if the template was deleted or has no current
 * version.
 */
async function loadTemplateNotificationContext(
  db: ReturnType<typeof createAdminClient>,
  templateId: string
): Promise<{ slug: string; title: string; authorLineUserId: string } | null> {
  const { data } = await db
    .from("trip_templates")
    .select(
      "slug, author_line_user_id, trip_template_versions!trip_templates_current_version_id_fkey(title)"
    )
    .eq("id", templateId)
    .is("deleted_at", null)
    .single();
  if (!data) return null;
  const version = data.trip_template_versions as { title: string } | null;
  return {
    slug: data.slug as string,
    title: version?.title ?? "Untitled",
    authorLineUserId: data.author_line_user_id as string,
  };
}

function maskDeleted(row: {
  id: string;
  line_user_id: string;
  body: string;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
}, nameMap: Record<string, string | null>): CommentView {
  if (row.deleted_at) {
    return {
      id: row.id,
      line_user_id: null,
      author_display_name: null,
      body: null,
      created_at: row.created_at,
      edited_at: row.edited_at,
      deleted_at: row.deleted_at,
    };
  }
  return {
    id: row.id,
    line_user_id: row.line_user_id,
    author_display_name: nameMap[row.line_user_id] ?? null,
    body: row.body,
    created_at: row.created_at,
    edited_at: row.edited_at,
    deleted_at: null,
  };
}

export async function listComments(
  slug: string,
  viewerLineUserId: string,
  limit = 20,
  offset = 0
): Promise<
  TemplateResult<{
    comments: CommentView[];
    hasMore: boolean;
    nextOffset: number;
  }>
> {
  const resolved = await resolveAccessibleTemplate(slug, viewerLineUserId);
  if (!resolved.ok) return resolved;

  const db = createAdminClient();
  const pageSize = Math.min(Math.max(limit, 1), 100);

  const { data: rows, error } = await db
    .from("template_comments")
    .select("id, line_user_id, body, created_at, edited_at, deleted_at")
    .eq("template_id", resolved.data.id)
    .order("created_at", { ascending: true })
    .range(offset, offset + pageSize);

  if (error) {
    return { ok: false, error: "Failed to load comments", code: "DB_ERROR" };
  }

  const raw = (rows ?? []) as Array<{
    id: string;
    line_user_id: string;
    body: string;
    created_at: string;
    edited_at: string | null;
    deleted_at: string | null;
  }>;
  const hasMore = raw.length > pageSize;
  const page = hasMore ? raw.slice(0, pageSize) : raw;

  const nameMap = await resolveDisplayNames(
    db,
    page.filter((r) => !r.deleted_at).map((r) => r.line_user_id)
  );
  const comments = page.map((r) => maskDeleted(r, nameMap));

  return {
    ok: true,
    data: {
      comments,
      hasMore,
      nextOffset: offset + page.length,
    },
  };
}

export async function addComment(
  slug: string,
  lineUserId: string,
  body: string
): Promise<TemplateResult<{ comment: CommentView }>> {
  const trimmed = body.trim();
  if (trimmed.length === 0 || trimmed.length > 2000) {
    return {
      ok: false,
      error: "Comment must be 1–2000 characters",
      code: "VALIDATION_ERROR",
    };
  }

  const resolved = await resolveAccessibleTemplate(slug, lineUserId);
  if (!resolved.ok) return resolved;

  const db = createAdminClient();
  const { data, error } = await db
    .from("template_comments")
    .insert({
      template_id: resolved.data.id,
      line_user_id: lineUserId,
      body: trimmed,
    })
    .select("id, line_user_id, body, created_at, edited_at, deleted_at")
    .single();

  if (error || !data) {
    return { ok: false, error: "Failed to post comment", code: "DB_ERROR" };
  }

  const nameMap = await resolveDisplayNames(db, [lineUserId]);
  const comment = maskDeleted(
    data as {
      id: string;
      line_user_id: string;
      body: string;
      created_at: string;
      edited_at: string | null;
      deleted_at: string | null;
    },
    nameMap
  );

  // Notify the template author of a new comment (best-effort; skips self-notify)
  const ctx = await loadTemplateNotificationContext(db, resolved.data.id);
  if (ctx) {
    await notifyNewComment({
      authorLineUserId: ctx.authorLineUserId,
      commenterLineUserId: lineUserId,
      commenterDisplayName: nameMap[lineUserId] ?? null,
      slug: ctx.slug,
      templateTitle: ctx.title,
      commentId: comment.id,
      bodyExcerpt: trimmed.slice(0, 140),
    });
  }

  return { ok: true, data: { comment } };
}

export async function updateComment(
  slug: string,
  commentId: string,
  lineUserId: string,
  body: string
): Promise<TemplateResult<{ comment: CommentView }>> {
  const trimmed = body.trim();
  if (trimmed.length === 0 || trimmed.length > 2000) {
    return {
      ok: false,
      error: "Comment must be 1–2000 characters",
      code: "VALIDATION_ERROR",
    };
  }

  const db = createAdminClient();

  // Look up comment + its template to verify slug and ownership
  const { data: existing } = await db
    .from("template_comments")
    .select("id, template_id, line_user_id, deleted_at, trip_templates!inner(slug)")
    .eq("id", commentId)
    .single();

  if (!existing) return { ok: false, error: "Comment not found", code: "NOT_FOUND" };

  const joinedSlug = (existing.trip_templates as { slug: string } | null)?.slug;
  if (joinedSlug !== slug) {
    return { ok: false, error: "Comment not found", code: "NOT_FOUND" };
  }
  if ((existing.line_user_id as string) !== lineUserId) {
    return { ok: false, error: "You can only edit your own comments", code: "FORBIDDEN" };
  }
  if (existing.deleted_at) {
    return { ok: false, error: "Cannot edit a deleted comment", code: "CONFLICT" };
  }

  const { data: updated, error } = await db
    .from("template_comments")
    .update({ body: trimmed, edited_at: new Date().toISOString() })
    .eq("id", commentId)
    .select("id, line_user_id, body, created_at, edited_at, deleted_at")
    .single();
  if (error || !updated) {
    return { ok: false, error: "Failed to update comment", code: "DB_ERROR" };
  }

  const nameMap = await resolveDisplayNames(db, [lineUserId]);
  return {
    ok: true,
    data: {
      comment: maskDeleted(
        updated as {
          id: string;
          line_user_id: string;
          body: string;
          created_at: string;
          edited_at: string | null;
          deleted_at: string | null;
        },
        nameMap
      ),
    },
  };
}

export async function deleteComment(
  slug: string,
  commentId: string,
  lineUserId: string
): Promise<TemplateResult<{ deleted: boolean }>> {
  const db = createAdminClient();

  const { data: existing } = await db
    .from("template_comments")
    .select("id, line_user_id, deleted_at, trip_templates!inner(slug, author_line_user_id)")
    .eq("id", commentId)
    .single();

  if (!existing) return { ok: false, error: "Comment not found", code: "NOT_FOUND" };

  const tmpl = existing.trip_templates as
    | { slug: string; author_line_user_id: string }
    | null;
  if (tmpl?.slug !== slug) {
    return { ok: false, error: "Comment not found", code: "NOT_FOUND" };
  }

  const isCommenter = (existing.line_user_id as string) === lineUserId;
  const isTemplateAuthor = tmpl.author_line_user_id === lineUserId;
  if (!isCommenter && !isTemplateAuthor) {
    return { ok: false, error: "Not allowed to delete this comment", code: "FORBIDDEN" };
  }

  if (existing.deleted_at) {
    // Already deleted — treat as success (idempotent)
    return { ok: true, data: { deleted: true } };
  }

  const { error } = await db
    .from("template_comments")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", commentId);
  if (error) {
    return { ok: false, error: "Failed to delete comment", code: "DB_ERROR" };
  }
  return { ok: true, data: { deleted: true } };
}

// ─── Access requests (request-only templates) ────────────────────────────────

export interface AccessRequestView {
  id: string;
  requester_user_id: string;
  requester_display_name: string | null;
  status: "pending" | "approved" | "denied";
  message: string | null;
  decided_at: string | null;
  created_at: string;
}

function toAccessRequestView(
  row: {
    id: string;
    requester_user_id: string;
    status: string;
    message: string | null;
    decided_at: string | null;
    created_at: string;
  },
  nameMap: Record<string, string | null>
): AccessRequestView {
  return {
    id: row.id,
    requester_user_id: row.requester_user_id,
    requester_display_name: nameMap[row.requester_user_id] ?? null,
    status: row.status as "pending" | "approved" | "denied",
    message: row.message,
    decided_at: row.decided_at,
    created_at: row.created_at,
  };
}

/**
 * Submit (or re-submit) a request to access a request_only template.
 *
 * Idempotency: if the requester has an existing row we upsert it back to
 * 'pending' with the new message. Already-granted users are rejected with
 * CONFLICT so the UI can surface "you already have access" instead of
 * pretending a new request was opened.
 */
export async function requestTemplateAccess(
  slug: string,
  lineUserId: string,
  message: string | null
): Promise<TemplateResult<{ request: AccessRequestView }>> {
  const db = createAdminClient();

  const { data: template } = await db
    .from("trip_templates")
    .select("id, visibility, author_line_user_id")
    .eq("slug", slug)
    .is("deleted_at", null)
    .single();
  if (!template) return { ok: false, error: "Template not found", code: "NOT_FOUND" };

  if ((template.visibility as string) !== "request_only") {
    return {
      ok: false,
      error: "This template doesn't accept access requests",
      code: "CONFLICT",
    };
  }
  if ((template.author_line_user_id as string) === lineUserId) {
    return {
      ok: false,
      error: "You are the author of this template",
      code: "VALIDATION_ERROR",
    };
  }

  const { data: existingGrant } = await db
    .from("template_grants")
    .select("template_id")
    .eq("template_id", template.id as string)
    .eq("line_user_id", lineUserId)
    .maybeSingle();
  if (existingGrant) {
    return { ok: false, error: "You already have access", code: "CONFLICT" };
  }

  const trimmed = (message ?? "").trim().slice(0, 500);
  const { data: upserted, error } = await db
    .from("template_access_requests")
    .upsert(
      {
        template_id: template.id as string,
        requester_user_id: lineUserId,
        status: "pending",
        message: trimmed || null,
        decided_at: null,
      },
      { onConflict: "template_id,requester_user_id" }
    )
    .select("*")
    .single();
  if (error || !upserted) {
    return { ok: false, error: "Failed to submit request", code: "DB_ERROR" };
  }

  const nameMap = await resolveDisplayNames(db, [lineUserId]);

  // Notify the template author (best-effort)
  const ctx = await loadTemplateNotificationContext(db, template.id as string);
  if (ctx) {
    await notifyAccessRequested({
      authorLineUserId: ctx.authorLineUserId,
      requesterLineUserId: lineUserId,
      requesterDisplayName: nameMap[lineUserId] ?? null,
      slug: ctx.slug,
      templateTitle: ctx.title,
      message: trimmed || null,
    });
  }

  return {
    ok: true,
    data: {
      request: toAccessRequestView(
        upserted as {
          id: string;
          requester_user_id: string;
          status: string;
          message: string | null;
          decided_at: string | null;
          created_at: string;
        },
        nameMap
      ),
    },
  };
}

export async function listAccessRequests(
  slug: string,
  authorLineUserId: string,
  statusFilter?: "pending" | "approved" | "denied"
): Promise<TemplateResult<{ requests: AccessRequestView[] }>> {
  const tmpl = await loadTemplateAsAuthor(slug, authorLineUserId);
  if (!tmpl.ok) return tmpl;

  const db = createAdminClient();
  let query = db
    .from("template_access_requests")
    .select("*")
    .eq("template_id", tmpl.data.id)
    .order("created_at", { ascending: false });
  if (statusFilter) query = query.eq("status", statusFilter);

  const { data: rows, error } = await query;
  if (error) {
    return { ok: false, error: "Failed to load requests", code: "DB_ERROR" };
  }

  const raw = (rows ?? []) as Array<{
    id: string;
    requester_user_id: string;
    status: string;
    message: string | null;
    decided_at: string | null;
    created_at: string;
  }>;
  const nameMap = await resolveDisplayNames(
    db,
    raw.map((r) => r.requester_user_id)
  );
  const requests = raw.map((r) => toAccessRequestView(r, nameMap));

  return { ok: true, data: { requests } };
}

/**
 * Author-only decision on a pending request. On approval, upserts a grant
 * with source='request'. On failure to create the grant, rolls the status
 * back to pending so the author can retry.
 */
export async function decideAccessRequest(
  slug: string,
  requestId: string,
  authorLineUserId: string,
  decision: "approved" | "denied"
): Promise<TemplateResult<{ request: AccessRequestView }>> {
  const tmpl = await loadTemplateAsAuthor(slug, authorLineUserId);
  if (!tmpl.ok) return tmpl;

  const db = createAdminClient();

  const { data: existing } = await db
    .from("template_access_requests")
    .select("*")
    .eq("id", requestId)
    .eq("template_id", tmpl.data.id)
    .single();
  if (!existing) {
    return { ok: false, error: "Request not found", code: "NOT_FOUND" };
  }
  if ((existing.status as string) !== "pending") {
    return {
      ok: false,
      error: "Request has already been decided",
      code: "CONFLICT",
    };
  }

  const nowIso = new Date().toISOString();
  const { data: updated, error: updErr } = await db
    .from("template_access_requests")
    .update({ status: decision, decided_at: nowIso })
    .eq("id", requestId)
    .select("*")
    .single();
  if (updErr || !updated) {
    return { ok: false, error: "Failed to update request", code: "DB_ERROR" };
  }

  if (decision === "approved") {
    const { error: grantErr } = await db
      .from("template_grants")
      .upsert(
        {
          template_id: tmpl.data.id,
          line_user_id: existing.requester_user_id as string,
          granted_by: authorLineUserId,
          source: "request",
        },
        { onConflict: "template_id,line_user_id" }
      );
    if (grantErr) {
      // Roll the request status back so the author can retry
      await db
        .from("template_access_requests")
        .update({ status: "pending", decided_at: null })
        .eq("id", requestId);
      return { ok: false, error: "Failed to grant access", code: "DB_ERROR" };
    }
  }

  const nameMap = await resolveDisplayNames(db, [
    updated.requester_user_id as string,
    authorLineUserId,
  ]);

  // Notify the requester (best-effort)
  const ctx = await loadTemplateNotificationContext(db, tmpl.data.id);
  if (ctx) {
    await notifyAccessDecided({
      requesterLineUserId: updated.requester_user_id as string,
      decision,
      slug: ctx.slug,
      templateTitle: ctx.title,
      authorDisplayName: nameMap[authorLineUserId] ?? null,
    });
  }

  return {
    ok: true,
    data: {
      request: toAccessRequestView(
        updated as {
          id: string;
          requester_user_id: string;
          status: string;
          message: string | null;
          decided_at: string | null;
          created_at: string;
        },
        nameMap
      ),
    },
  };
}

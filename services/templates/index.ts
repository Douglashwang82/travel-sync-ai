import { createHash, randomBytes } from "node:crypto";
import { createAdminClient } from "@/lib/db";
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

  return {
    ok: true,
    data: {
      template: template as unknown as TripTemplate,
      version: version as unknown as TripTemplateVersion,
      items,
      access,
      isAuthor,
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

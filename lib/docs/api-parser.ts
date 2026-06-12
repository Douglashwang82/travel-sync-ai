import "server-only";

import { promises as fs } from "node:fs";
import path from "node:path";
import { cache } from "react";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS" | "HEAD";

export interface ApiEndpoint {
  /** Public URL pattern, e.g. /api/app/trips/{tripId}/items */
  pattern: string;
  /** HTTP methods this route handler exports. */
  methods: HttpMethod[];
  /** Repo-relative source path, for "view source" links. */
  source: string;
  /** First sentence-style description, parsed from a JSDoc/leading comment, if any. */
  summary: string | null;
  /** Whether the route ships a Zod request schema (lightweight check). */
  hasZodSchema: boolean;
  /** Whether this route requires the cron secret header (`lib/cron-auth`). */
  isCronAuthed: boolean;
}

export interface ApiGroup {
  /** Stable slug for the section, used in anchor links. */
  slug: string;
  /** Display label for the group. */
  label: string;
  endpoints: ApiEndpoint[];
}

const ROUTE_FILENAME = "route.ts";
const HTTP_METHODS: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"];

async function walk(dir: string, out: string[] = []): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(fullPath, out);
    } else if (entry.isFile() && entry.name === ROUTE_FILENAME) {
      out.push(fullPath);
    }
  }
  return out;
}

function fileToPattern(absPath: string, repoRoot: string): string {
  const rel = path.relative(repoRoot, absPath);
  const parts = rel.split(path.sep);
  // Drop trailing "route.ts" and rewrite "app" → "" so we end up with /api/...
  const dirs = parts.slice(0, -1);
  if (dirs[0] === "app") dirs.shift();
  return (
    "/" +
    dirs
      .map((segment) => segment.replace(/^\[\.\.\.(.+)\]$/, "{...$1}").replace(/^\[(.+)\]$/, "{$1}"))
      .join("/")
  );
}

function extractMethods(source: string): HttpMethod[] {
  const found = new Set<HttpMethod>();
  for (const method of HTTP_METHODS) {
    const re = new RegExp(`export\\s+(?:async\\s+)?(?:function|const|let|var)\\s+${method}\\b`);
    if (re.test(source)) found.add(method);
  }
  return HTTP_METHODS.filter((m) => found.has(m));
}

function extractSummary(source: string): string | null {
  // Prefer a JSDoc block right before the first exported handler.
  const docMatch = source.match(
    /\/\*\*([\s\S]*?)\*\/\s*export\s+(?:async\s+)?(?:function|const|let|var)\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b/,
  );
  if (docMatch) {
    const body = docMatch[1]
      .split("\n")
      .map((line) => line.replace(/^\s*\*\s?/, "").trim())
      .filter(Boolean)
      .join(" ")
      .trim();
    if (body) return body.replace(/\s+/g, " ");
  }
  // Fall back to a single-line `//` comment immediately above a handler.
  const lineMatch = source.match(
    /\/\/\s*([^\n]+)\n\s*export\s+(?:async\s+)?(?:function|const|let|var)\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b/,
  );
  if (lineMatch) return lineMatch[1].trim();
  return null;
}

function deriveGroup(pattern: string): { slug: string; label: string; order: number } {
  // /api/app/trips/...     → App API · Trips
  // /api/app/templates/... → App API · Templates
  // /api/app/...           → App API · Other
  // /api/cron/...          → Cron jobs
  // /api/admin/...         → Admin
  // /api/line/...          → LINE webhook
  // /api/mcp, /api/health, /api/user → System
  const parts = pattern.split("/").filter(Boolean); // ["api", "app", "trips", ...]
  const top = parts[1] ?? "other";
  const sub = parts[2] ?? "";
  if (top === "app") {
    if (sub === "trips") return { slug: "api-app-trips", label: "App API · Trips", order: 1 };
    if (sub === "templates") return { slug: "api-app-templates", label: "App API · Templates", order: 2 };
    if (sub === "auth") return { slug: "api-app-auth", label: "App API · Auth", order: 3 };
    if (sub === "places") return { slug: "api-app-places", label: "App API · Places", order: 4 };
    if (sub === "notifications") return { slug: "api-app-notifications", label: "App API · Notifications", order: 5 };
    if (sub === "chat") return { slug: "api-app-chat", label: "App API · Chat", order: 6 };
    return { slug: "api-app-other", label: "App API · Other", order: 7 };
  }
  if (top === "home") return { slug: "api-home", label: "Home survey demo", order: 8 };
  if (top === "cron") return { slug: "api-cron", label: "Cron jobs", order: 10 };
  if (top === "admin") return { slug: "api-admin", label: "Admin", order: 20 };
  if (top === "line") return { slug: "api-line", label: "LINE webhook", order: 30 };
  return { slug: "api-system", label: "System", order: 99 };
}

export const loadApiEndpoints = cache(async (): Promise<ApiGroup[]> => {
  const repoRoot = process.cwd();
  const apiRoot = path.join(repoRoot, "app", "api");
  const files = (await walk(apiRoot)).sort();

  const groupMap = new Map<string, { label: string; order: number; endpoints: ApiEndpoint[] }>();

  for (const file of files) {
    let contents: string;
    try {
      contents = await fs.readFile(file, "utf8");
    } catch {
      continue;
    }
    const methods = extractMethods(contents);
    if (methods.length === 0) continue;
    const pattern = fileToPattern(file, repoRoot);
    const summary = extractSummary(contents);
    const hasZodSchema = /\bz\.object\s*\(/.test(contents) || /from\s+["']zod["']/.test(contents);
    const isCronAuthed = /requireCronAuth|cron-auth/.test(contents);
    const group = deriveGroup(pattern);
    const bucket = groupMap.get(group.slug) ?? { label: group.label, order: group.order, endpoints: [] };
    bucket.endpoints.push({
      pattern,
      methods,
      source: path.relative(repoRoot, file),
      summary,
      hasZodSchema,
      isCronAuthed,
    });
    groupMap.set(group.slug, bucket);
  }

  return Array.from(groupMap.entries())
    .map(([slug, b]) => ({
      slug,
      label: b.label,
      endpoints: b.endpoints.sort((a, z) => a.pattern.localeCompare(z.pattern)),
    }))
    .sort((a, z) => {
      const oa = groupMap.get(a.slug)?.order ?? 999;
      const oz = groupMap.get(z.slug)?.order ?? 999;
      return oa - oz;
    });
});

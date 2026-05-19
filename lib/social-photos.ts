/**
 * Cross-platform social-media photo discovery, used by the
 * `social_media_photos` agent.
 *
 * Why SerpAPI and not the official Instagram / TikTok APIs?
 *   - Instagram Graph API restricts content discovery to a verified Business
 *     account with App Review approval. Not feasible for a per-trip lookup
 *     against arbitrary public targets.
 *   - TikTok's Display API similarly requires partner approval and only
 *     surfaces content the authenticated user owns.
 *   - SerpAPI's Google Images engine, filtered with `site:instagram.com` /
 *     `site:tiktok.com`, returns publicly indexed photo thumbnails plus the
 *     original post URL. Same content a user would see in Google Image Search.
 *
 * Reads `SERPAPI_KEY` from env. Throws `SocialPhotosUnavailableError` when
 * the key is missing or the upstream call fails — callers should fall back
 * to an empty gallery with a helpful message.
 */

export type SocialPlatform = "instagram" | "tiktok";

export interface SocialPhoto {
  url: string;          // direct image URL (thumbnail; full-res lives on the source page)
  sourceUrl: string;    // link to the original post
  platform: SocialPlatform;
  title: string;        // post caption / title from the search result
}

export class SocialPhotosUnavailableError extends Error {
  constructor(message = "Social photo search is unavailable") {
    super(message);
    this.name = "SocialPhotosUnavailableError";
  }
}

interface SerpImageResult {
  position?: number;
  thumbnail?: string;
  original?: string;
  link?: string;
  title?: string;
  source?: string;
}

interface SerpResponse {
  images_results?: SerpImageResult[];
  error?: string;
}

const SERPAPI_BASE = "https://serpapi.com/search.json";
const FETCH_TIMEOUT_MS = 8_000;

function detectPlatform(link: string): SocialPlatform | null {
  if (link.includes("instagram.com")) return "instagram";
  if (link.includes("tiktok.com")) return "tiktok";
  return null;
}

function buildQuery(target: string, platforms: SocialPlatform[]): string {
  const sites = platforms.map((p) =>
    p === "instagram" ? "site:instagram.com" : "site:tiktok.com",
  );
  // Google's "OR" operator with parenthesized site filters returns posts from
  // any of the selected platforms in one search.
  const siteFilter = sites.length === 1 ? sites[0]! : `(${sites.join(" OR ")})`;
  return `${target} ${siteFilter}`;
}

export interface SearchOptions {
  target: string;
  platforms: SocialPlatform[];
  limit: number;
}

export async function searchSocialPhotos(
  opts: SearchOptions,
): Promise<SocialPhoto[]> {
  const apiKey = process.env.SERPAPI_KEY?.trim();
  if (!apiKey) {
    throw new SocialPhotosUnavailableError("SERPAPI_KEY is not configured");
  }
  if (opts.platforms.length === 0) return [];

  const q = buildQuery(opts.target, opts.platforms);
  const url =
    `${SERPAPI_BASE}?engine=google_images` +
    `&q=${encodeURIComponent(q)}` +
    `&safe=active` +
    `&api_key=${encodeURIComponent(apiKey)}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
    if (!res.ok) {
      throw new SocialPhotosUnavailableError(`SerpAPI returned ${res.status}`);
    }
    const payload = (await res.json()) as SerpResponse;
    if (payload.error) {
      throw new SocialPhotosUnavailableError(payload.error);
    }

    const photos: SocialPhoto[] = [];
    for (const r of payload.images_results ?? []) {
      const link = r.link;
      const thumb = r.thumbnail || r.original;
      if (!link || !thumb) continue;
      const platform = detectPlatform(link);
      if (!platform || !opts.platforms.includes(platform)) continue;
      photos.push({
        url: thumb,
        sourceUrl: link,
        platform,
        title: r.title?.trim() || r.source?.trim() || "",
      });
      if (photos.length >= opts.limit) break;
    }
    return photos;
  } catch (err) {
    if (err instanceof SocialPhotosUnavailableError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new SocialPhotosUnavailableError("SerpAPI request timed out");
    }
    throw new SocialPhotosUnavailableError(
      err instanceof Error ? err.message : "Unknown error",
    );
  } finally {
    clearTimeout(timeout);
  }
}

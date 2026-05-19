/**
 * Cross-platform social-media photo discovery for the
 * `social_media_photos` agent.
 *
 * Powered by Gemini's Google Search grounding tool in image-search mode:
 * we hand the model a target name + a list of allowed platforms and ask
 * it to surface relevant public posts. Each `GroundingChunkImage` returns
 * an `imageUri` (thumbnail) and a `sourceUri` (the original Instagram /
 * TikTok post page), which we filter by domain.
 *
 * No third-party API key needed — only the existing `GEMINI_API_KEY`.
 */

import {
  generateTextWithImageSearch,
  GeminiUnavailableError,
  type GroundedImage,
} from "@/lib/gemini";

export type SocialPlatform = "instagram" | "tiktok";

export interface SocialPhoto {
  url: string;          // direct image URL from Google's image cache
  sourceUrl: string;    // link to the original post
  platform: SocialPlatform;
  title: string;        // caption / title from the search result
}

export class SocialPhotosUnavailableError extends Error {
  constructor(message = "Social photo search is unavailable") {
    super(message);
    this.name = "SocialPhotosUnavailableError";
  }
}

function detectPlatform(host: string): SocialPlatform | null {
  if (host.includes("instagram.com")) return "instagram";
  if (host.includes("tiktok.com")) return "tiktok";
  return null;
}

function buildPrompt(target: string, platforms: SocialPlatform[], limit: number): string {
  const platformLabel = platforms
    .map((p) => (p === "instagram" ? "Instagram" : "TikTok"))
    .join(" 或 ");
  return [
    `請搜尋「${target}」在 ${platformLabel} 上的公開貼文照片。`,
    `只關注真正展示此地點 / 餐廳 / 度假村 / 景點外觀、餐點、空間或氛圍的照片。`,
    `略過無關縮圖、看似廣告或內容農場的結果。`,
    `目標是取得最多 ${limit} 張代表性照片。請用一句繁體中文簡短說明搜尋結果即可。`,
  ].join("\n");
}

function dedupe(images: GroundedImage[]): GroundedImage[] {
  const seen = new Set<string>();
  const out: GroundedImage[] = [];
  for (const img of images) {
    const key = img.imageUri;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(img);
  }
  return out;
}

export interface SearchOptions {
  target: string;
  platforms: SocialPlatform[];
  limit: number;
}

export async function searchSocialPhotos(opts: SearchOptions): Promise<SocialPhoto[]> {
  if (opts.platforms.length === 0) return [];

  let result;
  try {
    result = await generateTextWithImageSearch(
      "你是一位協助旅伴蒐集社群照片的搜尋助手。請使用內建的 Google Search 影像搜尋工具尋找指定目標的真實公開貼文照片,並回傳簡短說明。",
      buildPrompt(opts.target, opts.platforms, opts.limit),
    );
  } catch (err) {
    if (err instanceof GeminiUnavailableError) {
      throw new SocialPhotosUnavailableError(err.message);
    }
    throw new SocialPhotosUnavailableError(
      err instanceof Error ? err.message : "Unknown error",
    );
  }

  const photos: SocialPhoto[] = [];
  for (const img of dedupe(result.images)) {
    let host: string;
    try {
      host = new URL(img.sourceUri).hostname;
    } catch {
      continue;
    }
    const platform = detectPlatform(host);
    if (!platform || !opts.platforms.includes(platform)) continue;
    photos.push({
      url: img.imageUri,
      sourceUrl: img.sourceUri,
      platform,
      title: img.title.trim(),
    });
    if (photos.length >= opts.limit) break;
  }
  return photos;
}

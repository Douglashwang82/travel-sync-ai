// ─────────────────────────────────────────────────────────────────────────────
// Tracking List — source fetchers
//
// One fetcher per TrackingSourceType. Each returns a normalised FetchedItem[]
// and a content hash for change detection. Fetchers MUST NOT call the LLM —
// they only produce raw/structured text for the extractor stage.
//
// TODO (implementation): wire real providers. See system-design doc for the
// chosen stack (RSS parser, Firecrawl/Apify for HTML + social, YouTube Data
// API for YT). This file is a scaffold only.
// ─────────────────────────────────────────────────────────────────────────────

import type { FetchedItem, TrackingSourceType } from "./types";

export interface FetchResult {
  items: FetchedItem[];
  content_hash: string;
  raw_excerpt: string;
  http_status: number;
}

export type Fetcher = (url: string) => Promise<FetchResult>;

export const fetchers: Record<TrackingSourceType, Fetcher> = {
  website: async (_url) => {
    throw new Error("fetchers.website: not implemented");
  },
  rss: async (_url) => {
    throw new Error("fetchers.rss: not implemented");
  },
  instagram: async (_url) => {
    throw new Error("fetchers.instagram: not implemented");
  },
  threads: async (_url) => {
    throw new Error("fetchers.threads: not implemented");
  },
  x: async (_url) => {
    throw new Error("fetchers.x: not implemented");
  },
  youtube: async (_url) => {
    throw new Error("fetchers.youtube: not implemented");
  },
  tiktok: async (_url) => {
    throw new Error("fetchers.tiktok: not implemented");
  },
};

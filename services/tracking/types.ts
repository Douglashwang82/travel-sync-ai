// ─────────────────────────────────────────────────────────────────────────────
// Tracking List — shared domain types
// Mirrors the tracking_* tables from 20260417000000_tracking_lists.sql
// ─────────────────────────────────────────────────────────────────────────────

export type TrackingSourceType =
  | "website"
  | "rss"
  | "instagram"
  | "threads"
  | "x"
  | "youtube"
  | "tiktok";

export type TrackingCategory =
  | "travel"
  | "restaurant"
  | "attraction"
  | "event"
  | "other";

export type TrackingRunStatus =
  | "pending"
  | "running"
  | "success"
  | "failed"
  | "skipped";

export interface TrackingList {
  id: string;
  line_user_id: string;
  group_id: string | null;
  source_type: TrackingSourceType;
  source_url: string;
  display_name: string | null;
  category: TrackingCategory;
  keywords: string[];
  region: string | null;
  is_active: boolean;
  frequency_hours: number;
  last_run_at: string | null;
  last_success_at: string | null;
  consecutive_failures: number;
}

// Normalised shape produced by any fetcher before LLM parsing
export interface FetchedItem {
  external_id: string | null;
  title: string;
  url: string | null;
  image_url: string | null;
  body_text: string;
  published_at: string | null;
}

// Output of the LLM extractor — persisted to tracking_items
export interface ExtractedItem {
  external_id: string;
  title: string;
  summary: string;
  url: string | null;
  image_url: string | null;
  category: TrackingCategory;
  location: string | null;
  tags: string[];
}

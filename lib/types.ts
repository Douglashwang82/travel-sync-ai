// ─── Enums ────────────────────────────────────────────────────────────────────

export type GroupStatus = "active" | "removed" | "archived";

export type MemberRole = "organizer" | "member";

export type TripStatus = "draft" | "active" | "completed" | "cancelled";

export type ItemType =
  | "hotel"
  | "restaurant"
  | "activity"
  | "transport"
  | "insurance"
  | "flight"
  | "other";

export type ItemStage = "todo" | "pending" | "confirmed";

export type ItemKind = "knowledge" | "decision";

export type ItemSource = "ai" | "command" | "manual" | "system";

export type OptionProvider = "google_places" | "ota" | "manual";

export type EntityType =
  | "date"
  | "date_range"
  | "location"
  | "flight"
  | "hotel"
  | "preference"
  | "budget"
  | "constraint"
  | "conflict"
  | "availability";

export type EventProcessingStatus =
  | "pending"
  | "processing"
  | "processed"
  | "failed";

// ─── Domain types ─────────────────────────────────────────────────────────────

export interface LineGroup {
  id: string;
  line_group_id: string;
  name: string | null;
  status: GroupStatus;
  created_at: string;
  last_seen_at: string;
}

export interface GroupMember {
  id: string;
  group_id: string;
  line_user_id: string;
  display_name: string | null;
  role: MemberRole;
  joined_at: string;
  left_at: string | null;
}

export interface Trip {
  id: string;
  group_id: string;
  title: string | null;
  destination_name: string;
  destination_place_id: string | null;
  start_date: string | null;
  end_date: string | null;
  status: TripStatus;
  created_by_user_id: string;
  created_at: string;
  ended_at: string | null;
}

export interface TripItem {
  id: string;
  trip_id: string;
  item_type: ItemType;
  item_kind: ItemKind;
  title: string;
  description: string | null;
  stage: ItemStage;
  source: ItemSource;
  status_reason: string | null;
  confirmed_option_id: string | null;
  deadline_at: string | null;
  tie_extension_count: number;
  created_at: string;
  updated_at: string;
}

export interface TripItemOption {
  id: string;
  trip_item_id: string;
  provider: OptionProvider;
  external_ref: string | null;
  name: string;
  image_url: string | null;
  rating: number | null;
  price_level: string | null;
  distance_meters: number | null;
  address: string | null;
  booking_url: string | null;
  metadata_json: Record<string, unknown>;
  created_at: string;
}

export interface Vote {
  id: string;
  trip_item_id: string;
  option_id: string;
  group_id: string;
  line_user_id: string;
  cast_at: string;
}

export interface ParsedEntity {
  id: string;
  group_id: string;
  trip_id: string | null;
  line_event_id: string;
  entity_type: EntityType;
  canonical_value: string;
  display_value: string;
  confidence_score: number;
  attributes_json: Record<string, unknown>;
  created_at: string;
}

export interface LineEvent {
  id: string;
  line_event_uid: string;
  group_id: string | null;
  event_type: string;
  payload_json: Record<string, unknown>;
  processing_status: EventProcessingStatus;
  failure_reason: string | null;
  received_at: string;
  processed_at: string | null;
  retry_count: number;
}

export interface AnalyticsEvent {
  id: string;
  event_name: string;
  group_id: string | null;
  user_id: string | null;
  properties: Record<string, unknown>;
  created_at: string;
}

// ─── API response shapes ──────────────────────────────────────────────────────

export interface ApiError {
  error: string;
  code: string;
  details?: unknown;
}

export interface BoardData {
  trip: Trip;
  knowledge: TripItem[];
  todo: TripItem[];
  pending: TripItem[];
  confirmed: TripItem[];
}

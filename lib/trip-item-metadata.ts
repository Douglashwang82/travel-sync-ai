import { z } from "zod";

// Zod schemas for trip_items.metadata jsonb — one shape per item_type.
// Validated at the API boundary so the DB column stays loosely typed.

export const HotelMetadataSchema = z.object({
  type: z.literal("hotel"),
  check_in_time: z.string().optional(),   // "14:00"
  check_out_time: z.string().optional(),  // "11:00"
  nights: z.number().int().positive().optional(),
  room_type: z.string().optional(),
  confirmation_number: z.string().optional(),
});

export const RestaurantMetadataSchema = z.object({
  type: z.literal("restaurant"),
  reservation_time: z.string().optional(), // "19:00"
  party_size: z.number().int().positive().optional(),
  cuisine: z.string().optional(),
  phone: z.string().optional(),
  confirmation_number: z.string().optional(),
});

export const TransportMetadataSchema = z.object({
  type: z.literal("transport"),
  mode: z
    .enum(["taxi", "rental", "bus", "train", "ferry", "rideshare", "other"])
    .optional(),
  pickup_time: z.string().optional(),
  pickup_location: z.string().optional(),
  dropoff_location: z.string().optional(),
  provider: z.string().optional(),
  confirmation_number: z.string().optional(),
});

export const FlightMetadataSchema = z.object({
  type: z.literal("flight"),
  flight_number: z.string().optional(),
  airline: z.string().optional(),
  departure_airport: z.string().optional(),
  arrival_airport: z.string().optional(),
  departure_time: z.string().optional(),  // ISO datetime
  arrival_time: z.string().optional(),    // ISO datetime
  terminal: z.string().optional(),
  gate: z.string().optional(),
  seat: z.string().optional(),
  confirmation_number: z.string().optional(),
});

export const ActivityMetadataSchema = z.object({
  type: z.literal("activity"),
  start_time: z.string().optional(),      // "10:00"
  duration_minutes: z.number().int().positive().optional(),
  meeting_point: z.string().optional(),
  ticket_required: z.boolean().optional(),
  confirmation_number: z.string().optional(),
});

export const InsuranceMetadataSchema = z.object({
  type: z.literal("insurance"),
  provider: z.string().optional(),
  policy_number: z.string().optional(),
  coverage_type: z.string().optional(),
  valid_from: z.string().optional(),      // ISO date
  valid_until: z.string().optional(),     // ISO date
  emergency_contact: z.string().optional(),
});

export const OtherMetadataSchema = z.object({
  type: z.literal("other"),
  notes: z.string().optional(),
});

export const TripItemMetadataSchema = z.discriminatedUnion("type", [
  HotelMetadataSchema,
  RestaurantMetadataSchema,
  TransportMetadataSchema,
  FlightMetadataSchema,
  ActivityMetadataSchema,
  InsuranceMetadataSchema,
  OtherMetadataSchema,
]);

export type HotelMetadata = z.infer<typeof HotelMetadataSchema>;
export type RestaurantMetadata = z.infer<typeof RestaurantMetadataSchema>;
export type TransportMetadata = z.infer<typeof TransportMetadataSchema>;
export type FlightMetadata = z.infer<typeof FlightMetadataSchema>;
export type ActivityMetadata = z.infer<typeof ActivityMetadataSchema>;
export type InsuranceMetadata = z.infer<typeof InsuranceMetadataSchema>;
export type OtherMetadata = z.infer<typeof OtherMetadataSchema>;
export type TripItemMetadata = z.infer<typeof TripItemMetadataSchema>;

export function emptyMetadata(type: TripItemMetadata["type"]): TripItemMetadata {
  return { type } as TripItemMetadata;
}

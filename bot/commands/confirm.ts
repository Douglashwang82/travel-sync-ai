import { z } from "zod";
import { createAdminClient } from "@/lib/db";
import { generateJson } from "@/lib/gemini";
import { confirmBooking } from "@/services/trip-state";
import { track } from "@/lib/analytics";
import type { CommandContext } from "../router";

const BookingExtractSchema = z.object({
  bookingType: z.enum(["flight", "hotel", "transport", "activity", "insurance", "other"]),
  reference: z.string().nullable(),
  propertyName: z.string().nullable(),
  checkIn: z.string().nullable(),   // YYYY-MM-DD
  checkOut: z.string().nullable(),  // YYYY-MM-DD
  flightNumber: z.string().nullable(),
  departureDate: z.string().nullable(),  // YYYY-MM-DD
  confidence: z.number().min(0).max(1),
});

type BookingExtract = z.infer<typeof BookingExtractSchema>;

/**
 * /confirm [forwarded booking text]
 *
 * Parses a forwarded confirmation e-mail or message, extracts the booking
 * reference and details, and marks the matching trip item as booked.
 *
 * Example:
 *   /confirm Booking confirmed! Hotel Sunshine ref ABC-123 check-in 2026-07-15
 */
export async function handleConfirm(
  args: string[],
  ctx: CommandContext,
  reply: (text: string) => Promise<void>
): Promise<void> {
  if (!ctx.dbGroupId || !ctx.userId) {
    await reply("This command must be used inside a group chat.");
    return;
  }

  const text = args.join(" ").trim();
  if (!text) {
    await reply(
      "Paste the booking confirmation text after /confirm.\n\n" +
        "Example: /confirm Booking confirmed! Ref AX-12345 Hotel Sunshine check-in July 15"
    );
    return;
  }

  const db = createAdminClient();

  const { data: trip } = await db
    .from("trips")
    .select("id, destination_name")
    .eq("group_id", ctx.dbGroupId)
    .in("status", ["draft", "active"])
    .single();

  if (!trip) {
    await reply("No active trip found. Use /start to create one first.");
    return;
  }

  await reply("Reading your booking confirmation...");

  let extract: BookingExtract;
  try {
    const raw = await generateJson<unknown>(
      `You are a booking confirmation parser. Extract structured data from a booking confirmation message.
Return JSON with these fields:
- bookingType: "flight" | "hotel" | "transport" | "activity" | "insurance" | "other"
- reference: the PNR, confirmation number, or booking reference (string or null)
- propertyName: hotel/airline/venue name (string or null)
- checkIn: ISO 8601 date YYYY-MM-DD for hotel check-in (null if not present)
- checkOut: ISO 8601 date YYYY-MM-DD for hotel check-out (null if not present)
- flightNumber: flight code like "JL123" (null if not a flight)
- departureDate: ISO 8601 date YYYY-MM-DD for flight (null if not a flight)
- confidence: 0.0–1.0 how confident you are this is a booking confirmation

Current year: ${new Date().getFullYear()}
Return ONLY valid JSON.`,
      text
    );
    const parsed = BookingExtractSchema.safeParse(raw);
    if (!parsed.success) throw new Error("invalid schema");
    extract = parsed.data;
  } catch {
    await reply(
      "I couldn't parse that confirmation. Please try:\n/booked [item name] [ref number]\n\n" +
        "Example: /booked hotel ABC-123"
    );
    return;
  }

  if (extract.confidence < 0.5) {
    await reply(
      "That doesn't look like a booking confirmation. Please forward the actual confirmation message.\n\n" +
        "Or use: /booked [item name] [ref number]"
    );
    return;
  }

  // Find best matching trip item
  const { data: candidates } = await db
    .from("trip_items")
    .select("id, title, item_type, booking_status")
    .eq("trip_id", trip.id)
    .eq("booking_status", "needed");

  if (!candidates?.length) {
    await reply("No items are waiting for a booking confirmation right now.");
    return;
  }

  // Match by type first, then property name substring
  let target = candidates.find((c) => c.item_type === extract.bookingType);
  if (!target && extract.propertyName) {
    const nameLower = extract.propertyName.toLowerCase();
    target = candidates.find((c) => c.title.toLowerCase().includes(nameLower));
  }
  if (!target) target = candidates[0];

  const bookingRef = extract.reference ?? extract.flightNumber ?? "N/A";

  const result = await confirmBooking({
    itemId: target.id,
    bookingRef,
    bookedByLineUserId: ctx.userId,
  });

  if (!result.ok) {
    if (result.code === "ALREADY_BOOKED") {
      await reply(`"${target.title}" is already marked as booked.`);
    } else {
      await reply(`Failed to record booking for "${target.title}". Please try: /booked ${target.title} ${bookingRef}`);
    }
    return;
  }

  await track("booking_confirmed", {
    groupId: ctx.dbGroupId,
    userId: ctx.userId,
    properties: { item_id: target.id, item_type: extract.bookingType, via: "confirm_command" },
  });

  const details: string[] = [];
  if (extract.propertyName) details.push(`Property: ${extract.propertyName}`);
  if (extract.checkIn) details.push(`Check-in: ${extract.checkIn}`);
  if (extract.checkOut) details.push(`Check-out: ${extract.checkOut}`);
  if (extract.flightNumber) details.push(`Flight: ${extract.flightNumber}`);
  if (extract.departureDate) details.push(`Departure: ${extract.departureDate}`);

  await reply(
    `✅ Booking confirmed for "${target.title}"!\n` +
      `Ref: ${bookingRef}\n` +
      (details.length ? details.join("\n") + "\n" : "") +
      `\nThis item is now fully booked on the trip board.`
  );
}

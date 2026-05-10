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
    await reply("這個指令只能在群組聊天中使用。");
    return;
  }

  const text = args.join(" ").trim();
  if (!text) {
    await reply(
      "請在 /confirm 後貼上預訂確認的內容。\n\n" +
        "範例：/confirm 訂房確認！訂位代碼 AX-12345 Hotel Sunshine 入住日 7/15"
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
    await reply("目前沒有進行中的旅程。請先使用 /start 建立旅程。");
    return;
  }

  await reply("正在讀取你的預訂確認⋯⋯");

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
      "我無法解析這份確認內容。請改用：\n/booked [項目名稱] [訂位代碼]\n\n" +
        "範例：/booked hotel ABC-123"
    );
    return;
  }

  if (extract.confidence < 0.5) {
    await reply(
      "這看起來不像是預訂確認，請轉寄實際的確認訊息。\n\n" +
        "或使用：/booked [項目名稱] [訂位代碼]"
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
    await reply("目前沒有等待預訂確認的項目。");
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
      await reply(`「${target.title}」已經標記為已預訂。`);
    } else {
      await reply(`記錄「${target.title}」的預訂失敗，請嘗試：/booked ${target.title} ${bookingRef}`);
    }
    return;
  }

  await track("booking_confirmed", {
    groupId: ctx.dbGroupId,
    userId: ctx.userId,
    properties: { item_id: target.id, item_type: extract.bookingType, via: "confirm_command" },
  });

  const details: string[] = [];
  if (extract.propertyName) details.push(`名稱：${extract.propertyName}`);
  if (extract.checkIn) details.push(`入住：${extract.checkIn}`);
  if (extract.checkOut) details.push(`退房：${extract.checkOut}`);
  if (extract.flightNumber) details.push(`航班：${extract.flightNumber}`);
  if (extract.departureDate) details.push(`出發日：${extract.departureDate}`);

  await reply(
    `✅ 已確認預訂「${target.title}」！\n` +
      `訂位代碼：${bookingRef}\n` +
      (details.length ? details.join("\n") + "\n" : "") +
      `\n這個項目已經在旅程看板上完成預訂。`
  );
}

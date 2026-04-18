import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/db";

const QuerySchema = z.object({
  lineGroupId: z.string().min(1),
  lineUserId: z.string().min(1),
});

const EMERGENCY_NUMBERS: Record<string, { police: string; ambulance: string; fire: string; embassy?: string }> = {
  JP: { police: "110", ambulance: "119", fire: "119", embassy: "+81-3-3224-5000" },
  TW: { police: "110", ambulance: "119", fire: "119" },
  TH: { police: "191", ambulance: "1669", fire: "199", embassy: "+66-2-627-7200" },
  SG: { police: "999", ambulance: "995", fire: "995", embassy: "+65-6737-9322" },
  KR: { police: "112", ambulance: "119", fire: "119", embassy: "+82-2-397-4114" },
  HK: { police: "999", ambulance: "999", fire: "999" },
  MY: { police: "999", ambulance: "999", fire: "994" },
  ID: { police: "110", ambulance: "118", fire: "113" },
  VN: { police: "113", ambulance: "115", fire: "114" },
  US: { police: "911", ambulance: "911", fire: "911" },
  GB: { police: "999", ambulance: "999", fire: "999" },
  FR: { police: "17", ambulance: "15", fire: "18" },
  DE: { police: "110", ambulance: "112", fire: "112" },
  AU: { police: "000", ambulance: "000", fire: "000" },
};

function detectCountryCode(destination: string | null): string | null {
  if (!destination) return null;
  const d = destination.toLowerCase();
  if (d.includes("japan") || d.includes("tokyo") || d.includes("osaka") || d.includes("kyoto")) return "JP";
  if (d.includes("taiwan") || d.includes("taipei")) return "TW";
  if (d.includes("thailand") || d.includes("bangkok") || d.includes("phuket")) return "TH";
  if (d.includes("singapore")) return "SG";
  if (d.includes("korea") || d.includes("seoul") || d.includes("busan")) return "KR";
  if (d.includes("hong kong")) return "HK";
  if (d.includes("malaysia") || d.includes("kuala lumpur")) return "MY";
  if (d.includes("indonesia") || d.includes("bali") || d.includes("jakarta")) return "ID";
  if (d.includes("vietnam") || d.includes("hanoi") || d.includes("ho chi minh")) return "VN";
  if (d.includes("united states") || d.includes("new york") || d.includes("los angeles")) return "US";
  if (d.includes("australia") || d.includes("sydney") || d.includes("melbourne")) return "AU";
  return null;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const params = Object.fromEntries(req.nextUrl.searchParams.entries());
  const parsed = QuerySchema.safeParse(params);
  if (!parsed.success) {
    return NextResponse.json({ error: "Missing lineGroupId or lineUserId" }, { status: 400 });
  }

  const { lineGroupId, lineUserId } = parsed.data;
  const db = createAdminClient();

  const { data: group } = await db
    .from("line_groups")
    .select("id")
    .eq("line_group_id", lineGroupId)
    .single();

  if (!group) {
    return NextResponse.json({ error: "Group not found" }, { status: 404 });
  }

  const { data: trip } = await db
    .from("trips")
    .select("id, destination_name, destination_google_maps_url, destination_formatted_address, start_date, end_date")
    .eq("group_id", group.id)
    .in("status", ["draft", "active"])
    .single();

  const { data: members } = await db
    .from("group_members")
    .select("line_user_id, display_name, role")
    .eq("group_id", group.id)
    .is("left_at", null)
    .order("display_name", { ascending: true });

  const countryCode = detectCountryCode(trip?.destination_name ?? null);
  const emergencyNumbers = countryCode ? EMERGENCY_NUMBERS[countryCode] ?? null : null;

  // Find organizer
  const organizer = members?.find((m) => m.role === "organizer");

  return NextResponse.json({
    trip: trip
      ? {
          id: trip.id,
          destinationName: trip.destination_name,
          destinationAddress: trip.destination_formatted_address,
          destinationMapUrl: trip.destination_google_maps_url,
          startDate: trip.start_date,
          endDate: trip.end_date,
        }
      : null,
    countryCode,
    emergencyNumbers,
    organizer: organizer
      ? { lineUserId: organizer.line_user_id, displayName: organizer.display_name }
      : null,
    members: (members ?? []).map((m) => ({
      lineUserId: m.line_user_id,
      displayName: m.display_name,
      isYou: m.line_user_id === lineUserId,
    })),
  });
}

import { NextRequest, NextResponse } from "next/server";
import { requireAppUser } from "@/lib/app-server";
import { countUnreadNotifications } from "@/services/notifications";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAppUser(req);
  if (!auth.ok) return auth.response;

  const count = await countUnreadNotifications(auth.lineUserId);
  return NextResponse.json({ count });
}

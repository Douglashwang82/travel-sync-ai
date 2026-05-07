import { NextRequest, NextResponse } from "next/server";
import { requireAppUser } from "@/lib/app-server";
import { listPopularDestinations } from "@/services/ideas";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAppUser(req);
  if (!auth.ok) return auth.response;

  const result = await listPopularDestinations();
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, code: result.code },
      { status: 500 }
    );
  }
  return NextResponse.json(result.data);
}

import { NextRequest, NextResponse } from "next/server";
import { requireAppUser } from "@/lib/app-server";
import { publicAgents } from "@/services/agents/registry";

/** GET /api/app/agents — list of agents available for custom bento grids. */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAppUser(req);
  if (!auth.ok) return auth.response;
  return NextResponse.json({ agents: publicAgents() });
}

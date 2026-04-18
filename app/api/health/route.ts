import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/db";

type CheckStatus = "ok" | "error";

interface HealthResponse {
  status: "ok" | "degraded";
  ts: string;
  checks: {
    db: CheckStatus;
    line: CheckStatus;
    gemini: CheckStatus;
  };
}

export async function GET(): Promise<NextResponse<HealthResponse>> {
  const checks: HealthResponse["checks"] = {
    db: "error",
    line: "error",
    gemini: "error",
  };

  // Database reachability
  try {
    const db = createAdminClient();
    const { error } = await db.from("line_groups").select("id").limit(1);
    if (!error) checks.db = "ok";
  } catch {
    // remains "error"
  }

  // LINE — presence of required credentials
  checks.line =
    process.env.LINE_CHANNEL_ACCESS_TOKEN && process.env.LINE_CHANNEL_SECRET
      ? "ok"
      : "error";

  // Gemini — presence of API key
  checks.gemini = process.env.GEMINI_API_KEY ? "ok" : "error";

  const allOk = Object.values(checks).every((v) => v === "ok");
  const body: HealthResponse = {
    status: allOk ? "ok" : "degraded",
    ts: new Date().toISOString(),
    checks,
  };

  return NextResponse.json(body, { status: allOk ? 200 : 503 });
}

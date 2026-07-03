import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/app-server";
import { deleteBenchmarkRun } from "@/services/trip-generation/benchmark-runner";

export const dynamic = "force-dynamic";

const ParamsSchema = z.object({ id: z.string().uuid() });

/**
 * Delete a single benchmark run row from the history. The generated template
 * itself is untouched — this only removes the score record.
 */
export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const auth = await requireAppUser(req);
  if (!auth.ok) return auth.response;

  const parsed = ParamsSchema.safeParse(await ctx.params);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid run id", code: "INVALID_ID" },
      { status: 400 }
    );
  }

  try {
    const deleted = await deleteBenchmarkRun(parsed.data.id);
    if (!deleted) {
      return NextResponse.json(
        { error: "Run not found", code: "NOT_FOUND" },
        { status: 404 }
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[benchmark/runs/:id] delete failed", err);
    return NextResponse.json(
      { error: "Failed to delete run", code: "DELETE_FAILED" },
      { status: 500 }
    );
  }
}

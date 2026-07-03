import { redirect } from "next/navigation";
import { readAppSessionCookie } from "@/lib/app-server";
import { BenchmarkClient } from "@/components/app/benchmark-client";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "TravelSync — Itinerary Benchmark",
};

export default async function BenchmarkPage() {
  const lineUserId = await readAppSessionCookie();
  if (!lineUserId) redirect("/app/sign-in?next=/app/benchmark");
  return <BenchmarkClient />;
}

import { redirect } from "next/navigation";
import { readAppSessionCookie } from "@/lib/app-server";
import { MyPoisClient } from "@/components/app/my-pois-client";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "TravelSync — My Places",
};

export default async function MyPoisPage() {
  const lineUserId = await readAppSessionCookie();
  if (!lineUserId) redirect("/app/sign-in?next=/app/pois");
  return <MyPoisClient />;
}

import { redirect } from "next/navigation";
import { readAppSessionCookie } from "@/lib/app-server";
import { GlobalMapView } from "@/components/app/global-map-view";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "TravelSync — Main Map",
};

export default async function GlobalMapPage() {
  const lineUserId = await readAppSessionCookie();
  if (!lineUserId) redirect("/app/sign-in?next=/app/map");

  return <GlobalMapView />;
}

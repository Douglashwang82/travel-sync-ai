import { IdeasDiscoveryClient } from "@/components/app/ideas-discovery";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Ideas — TravelSync",
  description:
    "Browse individual places, restaurants, and activities shared by other travelers.",
};

export default function IdeasPage() {
  return <IdeasDiscoveryClient />;
}

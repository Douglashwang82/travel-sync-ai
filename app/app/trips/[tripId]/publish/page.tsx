import { TripPublishClient } from "@/components/app/trip-publish";

export const dynamic = "force-dynamic";

export default async function PublishPage({
  params,
}: {
  params: Promise<{ tripId: string }>;
}) {
  const { tripId } = await params;
  return <TripPublishClient tripId={tripId} />;
}

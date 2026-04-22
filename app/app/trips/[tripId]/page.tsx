import { TripOverview } from "@/components/app/trip-overview";

export default async function TripOverviewPage({
  params,
}: {
  params: Promise<{ tripId: string }>;
}) {
  const { tripId } = await params;
  return <TripOverview tripId={tripId} />;
}

import { TripWorkspace } from "@/components/app/trip-workspace";

export default async function TripOverviewPage({
  params,
}: {
  params: Promise<{ tripId: string }>;
}) {
  const { tripId } = await params;
  return <TripWorkspace tripId={tripId} />;
}

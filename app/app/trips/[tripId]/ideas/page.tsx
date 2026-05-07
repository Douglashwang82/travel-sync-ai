import { TripIdeasClient } from "@/components/app/trip-ideas";

export default async function IdeasRoute({
  params,
}: {
  params: Promise<{ tripId: string }>;
}) {
  const { tripId } = await params;
  return <TripIdeasClient tripId={tripId} />;
}

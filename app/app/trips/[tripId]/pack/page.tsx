import { TripPackClient } from "@/components/app/trip-pack";

export default async function TripPackPage({
  params,
}: {
  params: Promise<{ tripId: string }>;
}) {
  const { tripId } = await params;
  return <TripPackClient tripId={tripId} />;
}

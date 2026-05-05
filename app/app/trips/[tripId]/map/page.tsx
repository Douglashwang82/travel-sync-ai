import { TripMapView } from "@/components/app/trip-map-view";

export default async function TripMapPage({
  params,
}: {
  params: Promise<{ tripId: string }>;
}) {
  const { tripId } = await params;
  return <TripMapView tripId={tripId} />;
}

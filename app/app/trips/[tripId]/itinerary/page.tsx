import { TripItineraryClient } from "@/components/app/trip-itinerary";

export default async function ItineraryRoute({
  params,
}: {
  params: Promise<{ tripId: string }>;
}) {
  const { tripId } = await params;
  return <TripItineraryClient tripId={tripId} />;
}

import { redirect } from "next/navigation";

export default async function ItineraryRoute({
  params,
}: {
  params: Promise<{ tripId: string }>;
}) {
  const { tripId } = await params;
  redirect(`/app/trips/${tripId}?scroll=itinerary`);
}

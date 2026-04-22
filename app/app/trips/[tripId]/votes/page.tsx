import { TripVotesClient } from "@/components/app/trip-votes";

export default async function VotesRoute({
  params,
}: {
  params: Promise<{ tripId: string }>;
}) {
  const { tripId } = await params;
  return <TripVotesClient tripId={tripId} />;
}

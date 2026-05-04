import { TripBoardView } from "@/components/app/trip-board-view";

export default async function TripBoardPage({
  params,
}: {
  params: Promise<{ tripId: string }>;
}) {
  const { tripId } = await params;
  return <TripBoardView tripId={tripId} />;
}

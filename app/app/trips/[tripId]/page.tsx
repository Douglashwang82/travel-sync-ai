import { TripBentoPage } from "@/components/app/trip-bento-page";

export default async function TripOverviewPage({
  params,
}: {
  params: Promise<{ tripId: string }>;
}) {
  const { tripId } = await params;
  return <TripBentoPage tripId={tripId} />;
}

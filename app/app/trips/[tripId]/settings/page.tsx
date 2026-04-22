import { TripSettingsClient } from "@/components/app/trip-settings";

export default async function SettingsRoute({
  params,
}: {
  params: Promise<{ tripId: string }>;
}) {
  const { tripId } = await params;
  return <TripSettingsClient tripId={tripId} />;
}

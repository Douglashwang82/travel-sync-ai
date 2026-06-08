import { TripWorkspace } from "@/components/app/trip-workspace";

/**
 * The trip overview — the panoramic bento workspace (and Orchestrator mode).
 * This was the trip landing page before the group chat room took that slot;
 * it stays reachable from the right rail's "Trip tools" links.
 */
export default async function TripOverviewPage({
  params,
}: {
  params: Promise<{ tripId: string }>;
}) {
  const { tripId } = await params;
  return <TripWorkspace tripId={tripId} />;
}

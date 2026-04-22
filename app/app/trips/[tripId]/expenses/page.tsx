import { TripExpensesClient } from "@/components/app/trip-expenses";

export default async function ExpensesRoute({
  params,
}: {
  params: Promise<{ tripId: string }>;
}) {
  const { tripId } = await params;
  return <TripExpensesClient tripId={tripId} />;
}

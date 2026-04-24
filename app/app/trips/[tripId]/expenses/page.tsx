import { TripExpensesClient } from "@/components/app/trip-expenses";
import { notFound, redirect } from "next/navigation";
import { readAppSessionCookie } from "@/lib/app-server";
import { loadTripExpensesForUser } from "@/lib/app-trip-expenses";

export default async function ExpensesRoute({
  params,
}: {
  params: Promise<{ tripId: string }>;
}) {
  const { tripId } = await params;
  const lineUserId = await readAppSessionCookie();
  if (!lineUserId) redirect(`/app/sign-in?next=/app/trips/${tripId}/expenses`);

  const initialData = await loadTripExpensesForUser(tripId, lineUserId);
  if (!initialData) notFound();

  return <TripExpensesClient tripId={tripId} initialData={initialData} />;
}

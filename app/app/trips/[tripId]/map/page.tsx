import { redirect } from "next/navigation";

export default async function MapRoute({
  params,
}: {
  params: Promise<{ tripId: string }>;
}) {
  const { tripId } = await params;
  redirect(`/app/trips/${tripId}?scroll=map`);
}

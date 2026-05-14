import { redirect } from "next/navigation";

export default async function PackRoute({
  params,
}: {
  params: Promise<{ tripId: string }>;
}) {
  const { tripId } = await params;
  redirect(`/app/trips/${tripId}?scroll=pack`);
}

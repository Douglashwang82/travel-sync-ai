import { redirect } from "next/navigation";

export default async function BoardRoute({
  params,
}: {
  params: Promise<{ tripId: string }>;
}) {
  const { tripId } = await params;
  redirect(`/app/trips/${tripId}?scroll=tasks`);
}

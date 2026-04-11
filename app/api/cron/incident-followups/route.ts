export async function POST() {
  return Response.json(
    {
      status: "scaffold",
      job: "incident-followups",
      message: "TravelSync AI v1.2 incident follow-up cron scaffold is in place.",
    },
    { status: 501 }
  );
}

export async function POST() {
  return Response.json(
    {
      status: "scaffold",
      job: "readiness-refresh",
      message: "TravelSync AI v1.2 readiness refresh cron scaffold is in place.",
    },
    { status: 501 }
  );
}

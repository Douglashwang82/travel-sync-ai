export async function POST() {
  return Response.json(
    {
      status: "scaffold",
      job: "daily-briefings",
      message: "TravelSync AI v1.2 daily briefings cron scaffold is in place.",
    },
    { status: 501 }
  );
}

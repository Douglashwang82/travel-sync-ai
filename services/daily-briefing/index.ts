export interface DailyBriefing {
  tripId: string;
  tripDate: string;
  shortText: string;
  sections: Array<{
    title: string;
    body: string;
  }>;
}

export async function generateDailyBriefing(
  tripId: string,
  tripDate: string
): Promise<DailyBriefing> {
  return {
    tripId,
    tripDate,
    shortText: "Daily briefing scaffolded for v1.2.",
    sections: [],
  };
}
